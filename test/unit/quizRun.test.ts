import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Hunk } from '../../src/git/hunk';
import { QuizHistory } from '../../src/learning/quizHistory';
import type { LLMProvider } from '../../src/llm/provider';
import { QuizService } from '../../src/services/quizService';
import { TranscriptStore, type Transcript } from '../../src/learning/transcripts';
import {
  chatShellHtml,
  historyItem,
  messageHtml,
  transcriptMeta,
} from '../../src/ui/chat/chatHtml';
import { toTranscript } from '../../src/ui/quizThreads';
import { QuizRun, type AnsweredQuestion } from '../../src/ui/quizRun';

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

const QUIZ = JSON.stringify({
  questions: [1, 2, 3].map((n) => ({
    type: 'predict',
    question: `Question ${n}?`,
    concept: 'closures',
    expected: `Answer ${n}.`,
  })),
});
const GRADE = JSON.stringify({ verdict: 'partly', feedback: 'Close.', missed: [], remember: 'R.' });

function setup(complete: LLMProvider['complete']) {
  const answered: AnsweredQuestion[] = [];
  let stored = {};
  const run = new QuizRun(hunk, '/repo', {
    quizService: new QuizService({
      createProvider: () => ({ id: 'vscodeLm', name: 'fake', complete }),
      buildContext: async () => ({
        languageId: 'javascript',
        frameworks: [],
        sections: [],
        dropped: [],
        diff: hunk.raw,
      }),
      maxOutputTokens: () => 500,
    }),
    history: new QuizHistory({ get: () => stored, set: async (d) => void (stored = d) }),
    onAnswer: (a) => answered.push(a),
  });
  return { run, answered };
}

const replying = () =>
  vi.fn<LLMProvider['complete']>(async (request) =>
    request.system.includes('grading') ? GRADE : QUIZ,
  );

describe('QuizRun', () => {
  it('starts with a loading message, then the first question', async () => {
    const { run } = setup(replying());
    const changes = vi.fn();
    run.onDidChange(changes);

    const started = run.start();
    expect(run.messages).toEqual([
      { from: 'tutor', text: 'Writing a few questions for you…', pending: true },
    ]);
    expect(run.canAnswer).toBe(false);
    await started;

    expect(run.messages).toHaveLength(1);
    expect(run.messages[0]?.text).toContain('Question 1 of 3');
    expect(run.canAnswer).toBe(true);
    expect(run.done).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('grades an answer and posts feedback with the next question in one message', async () => {
    const { run, answered } = setup(replying());
    await run.start();

    expect(await run.submit('   ')).toBe('empty');
    expect(await run.submit(' my answer ')).toBe('graded');

    expect(run.messages.slice(1).map((m) => m.from)).toEqual(['you', 'tutor']);
    expect(run.messages[1]?.text).toBe('my answer');
    expect(run.messages[2]?.text).toMatch(/Almost there[\s\S]*Question 2 of 3/);
    expect(answered.map((a) => [a.question.question, a.outcome])).toEqual([
      ['Question 1?', 'partly'],
    ]);
  });

  it('reveals and skips, then ends with a summary', async () => {
    const { run, answered } = setup(replying());
    await run.start();

    run.reveal();
    run.skip();
    await run.submit('last');

    expect(run.done).toBe(true);
    expect(run.canAnswer).toBe(false);
    expect(run.messages.at(-1)?.text).toContain('Quiz done!');
    expect(answered.map((a) => a.outcome)).toEqual(['revealed', 'skipped', 'partly']);
    expect(await run.submit('too late')).toBe('not-ready');
  });

  it('keeps the question open when grading fails, so the answer can be resent', async () => {
    let failGrade = true;
    const { run, answered } = setup(async (request) => {
      if (request.system.includes('grading') && failGrade) {
        throw new Error('network down');
      }
      return request.system.includes('grading') ? GRADE : QUIZ;
    });
    await run.start();

    expect(await run.submit('first try')).toBe('failed');
    expect(run.messages.at(-1)?.text).toContain("Couldn't check your answer");
    expect(run.canAnswer).toBe(true);
    expect(answered).toHaveLength(0);

    failGrade = false;
    expect(await run.submit('second try')).toBe('graded');
    expect(answered).toHaveLength(1);
  });

  it('reports a quiz that could not be written and is then done', async () => {
    const { run } = setup(async () => 'not json');
    await run.start();

    expect(run.messages).toHaveLength(1);
    expect(run.messages[0]?.text).toContain("Couldn't write a quiz");
    expect(run.done).toBe(true);
  });

  it('stops notifying after cancel', async () => {
    const { run } = setup(replying());
    const changes = vi.fn();
    run.onDidChange(changes);

    run.cancel();
    await run.start();

    expect(run.cancelled).toBe(true);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe('chat html', () => {
  it('renders tutor Markdown, escapes your text, and shows a typing indicator', () => {
    expect(messageHtml({ from: 'tutor', text: '**Hi** `code`' }).html).toContain(
      '<strong>Hi</strong> <code>code</code>',
    );
    expect(messageHtml({ from: 'you', text: '<b>x</b>\nnext' }).html).toBe(
      '&lt;b&gt;x&lt;/b&gt;<br>next',
    );
    expect(messageHtml({ from: 'tutor', text: 'Checking…', pending: true }).html).toContain(
      'class="typing"',
    );
  });

  it('does not render javascript: links', () => {
    const html = messageHtml({ from: 'tutor', text: '[click](javascript:alert(1))' }).html;
    expect(html).not.toContain('href="javascript:');
  });

  it('locks the page down: nonce scripts, no network', () => {
    const html = chatShellHtml({ nonce: 'n0nce', cspSource: 'vscode-webview://x', avatarUri: 'a' });

    expect(html).toContain(
      "default-src 'none'; img-src vscode-webview://x; style-src vscode-webview://x 'unsafe-inline'; script-src 'nonce-n0nce';",
    );
    expect(html.match(/<script nonce="n0nce">/g)).toHaveLength(1);
    // Placeholder text may mention URLs; nothing may be loaded from one.
    expect(html).not.toMatch(/(src|href)\s*=\s*["']?https?:/i);
  });
});

describe('quiz history', () => {
  // A fixed clock, so "1h ago" cannot drift to "59m ago" mid-test.
  const NOW = Date.UTC(2026, 9, 11, 12);
  const transcript = (over: Partial<Transcript> = {}): Transcript => ({
    id: 't1',
    startedAt: NOW - 60 * 60 * 1000,
    updatedAt: Date.now(),
    filePath: 'src/cart.js',
    line: 12,
    done: true,
    correct: 1,
    partly: 1,
    revealed: 1,
    skipped: 0,
    total: 3,
    questions: ['What does `total([])` return?'],
    messages: [{ from: 'tutor', text: 'Q' }],
    ...over,
  });

  it('summarizes a saved quiz', () => {
    const now = NOW;
    expect(transcriptMeta(transcript(), now)).toBe('1/2 correct, 1 partly · 1h ago');
    expect(transcriptMeta(transcript({ done: false }), now)).toMatch(/^In progress/);
    expect(transcriptMeta(transcript({ correct: 0, partly: 0, revealed: 3 }), now)).toMatch(
      /^Answers peeked/,
    );
  });

  it('builds escaped list items and marks the quiz shown in the chat', () => {
    const item = historyItem(transcript({ questions: ['Why `<T>`?'] }), NOW, 't1');

    expect(item).toMatchObject({ where: 'cart.js:12', current: true });
    expect(item.preview).toBe('Why <code>&lt;T&gt;</code>?');
  });

  it('records a run as a transcript, newest first, replacing earlier saves of the same quiz', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'patch-tutor-transcripts-'));
    try {
      const store = new TranscriptStore(join(dir, 'quizzes.json'));
      const { run } = setup(replying());
      await run.start();
      await store.save(toTranscript(run));
      await run.submit('answer');
      await store.save(toTranscript(run));
      await store.save({ ...transcript({ id: 'older', startedAt: 1 }) });

      const list = await new TranscriptStore(join(dir, 'quizzes.json')).list();
      expect(list.map((t) => t.id)).toEqual([run.id, 'older']);
      expect(list[0]).toMatchObject({ filePath: 'src/cart.js', partly: 1, done: false });
      expect(list[0]?.questions).toEqual(['Question 1?', 'Question 2?', 'Question 3?']);
      expect(list[0]?.messages.map((m) => m.from)).toEqual(['tutor', 'you', 'tutor']);

      await store.clear();
      expect(await store.list()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
