import { describe, expect, it, vi } from 'vitest';
import type { Hunk } from '../../src/git/hunk';
import type { LLMProvider } from '../../src/llm/provider';
import { FollowUpSchema, type Explanation } from '../../src/llm/schemas';
import followUpPrompt from '../../src/prompts/follow-up.md';
import type { HunkContext } from '../../src/services/explainService';
import {
  conversationForPrompt,
  FollowUpService,
  MAX_EXCHANGES,
  type Exchange,
  type FollowUpRequest,
} from '../../src/services/followUpService';

const hunk: Hunk = {
  id: 'h1',
  filePath: 'src/cart.js',
  status: 'modified',
  newStart: 1,
  newLines: 2,
  oldStart: 1,
  oldLines: 1,
  added: ['  return 0;'],
  removed: [],
  raw: '@@ -1,1 +1,2 @@\n function total() {\n+  return 0;',
};

const context: HunkContext = {
  languageId: 'javascript',
  frameworks: [],
  sections: [{ title: 'Enclosing code (lines 1-3)', text: 'function total() {}', priority: 1 }],
  dropped: [],
  diff: hunk.raw,
};

const explanation: Explanation = {
  summary: 'Returns zero early.',
  whatChanged: 'Adds a return.',
  howItWorks: 'It returns 0.',
  whyItWorks: 'Nothing else runs.',
  concepts: ['edge-cases'],
  risks: [],
  depth: 'standard',
};

function setup(reply: string | string[]) {
  const replies = Array.isArray(reply) ? [...reply] : [reply];
  const complete = vi.fn<LLMProvider['complete']>(async () => replies.shift() ?? '');
  const buildContext = vi.fn(async () => context);
  const service = new FollowUpService({
    createProvider: () => ({ id: 'vscodeLm', name: 'fake', complete }),
    buildContext,
    maxOutputTokens: () => 500,
  });
  const request: FollowUpRequest = {
    hunk,
    repoRoot: '/repo',
    depth: 'standard',
    explanation,
    history: [],
    question: '  Why return early?  ',
  };
  return { service, complete, buildContext, request };
}

describe('FollowUpSchema', () => {
  it('accepts an answer with or without a revision', () => {
    expect(FollowUpSchema.parse({ answer: 'Yes.' })).toEqual({
      answer: 'Yes.',
      revised: undefined,
    });
    expect(FollowUpSchema.parse({ answer: 'Fixed.', revised: explanation }).revised).toEqual(
      explanation,
    );
  });

  it('treats a null revision as no revision', () => {
    expect(FollowUpSchema.parse({ answer: 'No.', revised: null }).revised).toBeUndefined();
  });

  it('treats an empty revision object as no revision', () => {
    expect(FollowUpSchema.parse({ answer: 'A.', mistake: '', revised: {} })).toEqual({
      answer: 'A.',
      mistake: undefined,
      revised: undefined,
    });
  });

  it('rejects an empty answer', () => {
    expect(FollowUpSchema.safeParse({ answer: '' }).success).toBe(false);
  });
});

describe('conversationForPrompt', () => {
  const exchange = (n: number): Exchange => ({ question: `Q${n}?`, answer: `A${n}.` });

  it('says when there is no conversation yet', () => {
    expect(conversationForPrompt([])).toBe('(none yet)');
  });

  it(`keeps only the last ${MAX_EXCHANGES} exchanges and notes how many were left out`, () => {
    const history = Array.from({ length: MAX_EXCHANGES + 2 }, (_, i) => exchange(i + 1));
    const text = conversationForPrompt(history);
    expect(text).toMatch(/^\(2 earlier exchanges left out\)/);
    expect(text).not.toContain('Q2?');
    expect(text).toContain('Developer: Q3?');
    expect(text).toContain(`Tutor: A${MAX_EXCHANGES + 2}.`);
  });
});

describe('FollowUpService', () => {
  it('sends the diff, context, explanation, conversation and trimmed question', async () => {
    const { service, complete, request } = setup(JSON.stringify({ answer: 'To skip the loop.' }));

    const result = await service.ask({
      ...request,
      history: [{ question: 'What changed?', answer: 'A return.' }],
    });

    expect(result).toEqual({
      context,
      answer: 'To skip the loop.',
      revised: undefined,
      structured: true,
    });
    const sent = complete.mock.calls[0]?.[0];
    expect(sent?.system).toBe(followUpPrompt);
    expect(sent?.json).toBe(true);
    expect(sent?.user).toContain('+  return 0;');
    expect(sent?.user).toContain('function total() {}');
    expect(sent?.user).toContain('Summary: Returns zero early.');
    expect(sent?.user).toContain('Developer: What changed?');
    expect(sent?.user).toMatch(/## Their new message\n\nWhy return early\?\n?$/);
  });

  it('builds context only when none is passed in', async () => {
    const { service, buildContext, request } = setup([
      JSON.stringify({ answer: 'One.' }),
      JSON.stringify({ answer: 'Two.' }),
    ]);

    const first = await service.ask(request);
    await service.ask({ ...request, context: first.context });

    expect(buildContext).toHaveBeenCalledTimes(1);
  });

  it('returns a revision when the tutor names the mistake it corrects', async () => {
    const revised = { ...explanation, whyItWorks: 'Callers get 0 for empty carts.' };
    const mistake = 'It said nothing else runs, but callers still use the result.';
    const { service, request } = setup(
      JSON.stringify({ answer: 'You are right.', mistake, revised }),
    );

    const result = await service.ask(request);
    expect(result.revised).toEqual(revised);
    expect(result.mistake).toBe(mistake);
  });

  // Small models attach a "revision" to plain questions like "give me a dry run".
  it('ignores a revision that names no mistake', async () => {
    const revised = { ...explanation, whyItWorks: 'Reworded.' };
    for (const mistake of [undefined, null, '', '  ']) {
      const { service, request } = setup(
        JSON.stringify({ answer: 'A dry run…', mistake, revised }),
      );
      const result = await service.ask(request);
      expect(result.revised).toBeUndefined();
      expect(result.mistake).toBeUndefined();
    }
  });

  it('ignores a revision that only copies the explanation back', async () => {
    const copy = {
      ...explanation,
      summary: `  ${explanation.summary} `,
      depth: 'deep',
      concepts: ['Edge-Cases'],
    };
    const { service, request } = setup(
      JSON.stringify({ answer: 'Here it is.', mistake: 'None really.', revised: copy }),
    );

    expect((await service.ask(request)).revised).toBeUndefined();
  });

  // The exact shape GPT-4o mini returned for "give me a complete dry run".
  it('reads a dry-run answer with code blocks and empty placeholders', async () => {
    const answer =
      'Dry run:\n\n```javascript\nconst price = 100;\nconst percent = 20;\n```\n\n1. Returns 80.';
    const { service, complete, request } = setup(
      JSON.stringify({ answer, mistake: '', revised: {} }),
    );

    expect(await service.ask(request)).toEqual({
      context,
      answer,
      revised: undefined,
      mistake: undefined,
      structured: true,
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('keeps a valid answer when only the revision is malformed', async () => {
    const broken = JSON.stringify({ answer: 'Same number of calls.', revised: { summary: 'x' } });
    const { service, request } = setup([broken, broken]);

    expect(await service.ask(request)).toEqual({
      context,
      answer: 'Same number of calls.',
      structured: false,
    });
  });

  it('falls back to the raw text when the reply never matches the schema', async () => {
    const { service, request } = setup(['not json', '  Plain answer.  ']);

    expect(await service.ask(request)).toEqual({
      context,
      answer: 'Plain answer.',
      structured: false,
    });
  });
});
