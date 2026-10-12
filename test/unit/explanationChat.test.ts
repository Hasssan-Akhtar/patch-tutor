import { describe, expect, it, vi } from 'vitest';
import type { Hunk } from '../../src/git/hunk';
import type { LLMProvider } from '../../src/llm/provider';
import type { Explanation } from '../../src/llm/schemas';
import type { HunkContext } from '../../src/services/explainService';
import { FollowUpService } from '../../src/services/followUpService';
import { ExplanationChat } from '../../src/ui/explanationChat';

const hunk: Hunk = {
  id: 'h1',
  filePath: 'src/cart.js',
  status: 'modified',
  newStart: 1,
  newLines: 1,
  oldStart: 1,
  oldLines: 1,
  added: ['x'],
  removed: [],
  raw: '@@ -1 +1 @@\n+x',
};

const context: HunkContext = {
  languageId: 'javascript',
  frameworks: [],
  sections: [],
  dropped: [],
  diff: hunk.raw,
};

const explanation: Explanation = {
  summary: 'Sets x.',
  whatChanged: 'Adds x.',
  howItWorks: 'It assigns.',
  whyItWorks: 'Fewer calls.',
  concepts: ['naming'],
  risks: [],
  depth: 'standard',
};

function setup(complete: LLMProvider['complete']) {
  const buildContext = vi.fn(async () => context);
  const chat = new ExplanationChat(
    hunk,
    '/repo',
    'standard',
    explanation,
    new FollowUpService({
      createProvider: () => ({ id: 'vscodeLm', name: 'fake', complete }),
      buildContext,
      maxOutputTokens: () => 500,
    }),
  );
  return { chat, buildContext };
}

const reply = (value: object) => async () => JSON.stringify(value);

describe('ExplanationChat', () => {
  it('shows the question and a pending reply, then the answer', async () => {
    const { chat } = setup(reply({ answer: 'Because `x` is new.' }));
    const changes: string[] = [];
    chat.onDidChange(() => changes.push(chat.messages.map((m) => m.from).join(',')));

    const pending = chat.ask('  Why x?  ');
    expect(chat.busy).toBe(true);
    expect(chat.canSend).toBe(false);
    expect(chat.messages).toEqual([
      { from: 'you', text: 'Why x?' },
      { from: 'tutor', text: 'Thinking…', pending: true },
    ]);

    expect(await pending).toBe('answered');
    expect(chat.busy).toBe(false);
    expect(chat.messages.at(-1)).toEqual({ from: 'tutor', text: 'Because `x` is new.' });
    expect(changes).toEqual(['you,tutor', 'you,tutor']);
  });

  it('ignores blank messages and messages sent while busy', async () => {
    const { chat } = setup(reply({ answer: 'Done.' }));
    expect(await chat.ask('   ')).toBe('empty');

    const first = chat.ask('One?');
    expect(await chat.ask('Two?')).toBe('not-ready');
    await first;
    expect(chat.messages.filter((m) => m.from === 'you')).toHaveLength(1);
  });

  it('sends earlier exchanges and reuses context on later questions', async () => {
    const complete = vi.fn<LLMProvider['complete']>(reply({ answer: 'A.' }));
    const { chat, buildContext } = setup(complete);

    await chat.ask('First?');
    await chat.ask('Second?');

    expect(buildContext).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[1]?.[0].user).toContain('Developer: First?');
  });

  it('replaces the explanation when the tutor revises it, keeping its depth', async () => {
    const revised = { ...explanation, whyItWorks: 'Same calls, smaller rows.', depth: 'deep' };
    const { chat } = setup(reply({ answer: 'You are right.', revised }));

    await chat.ask('It does not reduce calls, does it?');

    expect(chat.revised).toBe(true);
    expect(chat.explanation).toEqual({ ...revised, depth: 'standard' });
    expect(chat.messages.at(-1)?.text).toMatch(/You are right\.[\s\S]*corrected the explanation/);
  });

  it('escapes HTML in answers', async () => {
    const { chat } = setup(reply({ answer: '<img src=x> ![a](b)' }));
    await chat.ask('Q?');
    expect(chat.messages.at(-1)?.text).not.toContain('<img');
    expect(chat.messages.at(-1)?.text).toContain('!\\[');
  });

  it('shows a provider error and stays usable', async () => {
    let calls = 0;
    const { chat } = setup(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('rate limited');
      }
      return JSON.stringify({ answer: 'Now it works.' });
    });

    expect(await chat.ask('Q?')).toBe('failed');
    expect(chat.messages.at(-1)?.text).toMatch(/Couldn't answer that\.\*\* rate limited/);
    expect(chat.canSend).toBe(true);
    expect(await chat.ask('Q again?')).toBe('answered');
  });

  it('adds nothing after being cancelled mid-request', async () => {
    let finish: ((text: string) => void) | undefined;
    const { chat } = setup(() => new Promise<string>((resolve) => (finish = resolve)));
    const listener = vi.fn();
    chat.onDidChange(listener);

    const pending = chat.ask('Q?');
    // Context is built asynchronously before the provider is called.
    await vi.waitFor(() => expect(finish).toBeDefined());
    listener.mockClear();
    chat.cancel();
    finish?.(JSON.stringify({ answer: 'Too late.' }));

    expect(await pending).toBe('failed');
    expect(listener).not.toHaveBeenCalled();
    expect(chat.canSend).toBe(false);
    expect(chat.messages.some((m) => m.text === 'Too late.')).toBe(false);
  });
});
