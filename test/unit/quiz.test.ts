import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Hunk } from '../../src/git/hunk';
import { QuizSession, type QuizSummary } from '../../src/learning/quizSession';
import { ReportStore } from '../../src/learning/reports';
import type { LLMProvider } from '../../src/llm/provider';
import { GradeSchema, QuizSchema, type Question } from '../../src/llm/schemas';
import gradePrompt from '../../src/prompts/grade.md';
import quizPrompt from '../../src/prompts/quiz.md';
import type { HunkContext } from '../../src/services/explainService';
import { QuizService } from '../../src/services/quizService';
import {
  gradeMarkdown,
  questionMarkdown,
  revealMarkdown,
  summaryMarkdown,
} from '../../src/ui/quizMarkdown';

const question = (n: number, concept = `concept-${n}`): Question => ({
  id: `q${n}`,
  type: 'predict',
  question: `What does \`f(${n})\` return?`,
  concept,
  expected: `It returns ${n}.`,
});

describe('QuizSchema', () => {
  it('accepts loose question type spellings and numeric ids', () => {
    const parsed = QuizSchema.parse({
      questions: [
        { id: 1, type: 'Spot the bug', question: 'q', concept: 'c', expected: 'e' },
        { type: 'spot_the_bug', question: 'q', concept: 'c', expected: 'e' },
        { type: 'PREDICT', question: 'q', concept: 'c', expected: 'e' },
      ],
    });

    expect(parsed.questions.map((q) => [q.id, q.type])).toEqual([
      ['1', 'spot-the-bug'],
      [undefined, 'spot-the-bug'],
      [undefined, 'predict'],
    ]);
  });

  it('rejects unknown types and empty quizzes', () => {
    expect(QuizSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      QuizSchema.safeParse({
        questions: [{ type: 'essay', question: 'q', concept: 'c', expected: 'e' }],
      }).success,
    ).toBe(false);
  });
});

describe('GradeSchema', () => {
  it('normalizes the verdict', () => {
    const grade = GradeSchema.parse({
      verdict: ' Partly ',
      feedback: 'f',
      missed: [],
      remember: 'r',
    });
    expect(grade.verdict).toBe('partly');
  });
});

describe('QuizSession', () => {
  it('walks through questions and summarizes outcomes', () => {
    const session = new QuizSession([
      question(1),
      question(2, 'closures'),
      question(3, 'closures'),
    ]);

    expect(session.current?.id).toBe('q1');
    session.record('correct');
    session.record('partly');
    expect(session.index).toBe(2);
    session.record('revealed');

    expect(session.done).toBe(true);
    expect(session.current).toBeUndefined();
    expect(session.summary()).toMatchObject({
      correct: 1,
      partly: 1,
      revealed: 1,
      skipped: 0,
      total: 3,
      toReview: ['closures'],
    });
    expect(() => session.record('correct')).toThrow(/finished/);
  });
});

describe('quiz markdown', () => {
  it('introduces the quiz on the first question only', () => {
    expect(questionMarkdown(question(1), 0, 3)).toMatch(
      /^Let's see how well this change sticks: 3 quick/,
    );
    expect(questionMarkdown(question(2), 1, 3)).not.toContain("Let's see");
    expect(questionMarkdown(question(2), 1, 3)).toContain('Question 2 of 3');
    expect(questionMarkdown(question(2), 1, 3)).toContain('🔮 Predict');
  });

  it('shows the model answer only when the answer was not correct', () => {
    const correct = gradeMarkdown(
      { verdict: 'correct', feedback: 'Yes.', missed: [], remember: 'R.' },
      question(1),
    );
    const partly = gradeMarkdown(
      { verdict: 'partly', feedback: 'Close.', missed: ['the empty case'], remember: 'R.' },
      question(1),
    );

    expect(correct).toContain('Nailed it!');
    expect(correct).not.toContain('A good answer');
    expect(partly).toContain('Almost there');
    expect(partly).toContain('**Missing piece:** the empty case');
    expect(partly).toContain('**A good answer:** It returns 1.');
    expect(partly).toContain('**Remember:** R.');
  });

  it('escapes model text in questions and grades', () => {
    expect(questionMarkdown({ ...question(1), question: '<img src=x>' }, 0, 1)).toContain(
      '&lt;img',
    );
    expect(revealMarkdown({ ...question(1), expected: '![x](https://e.x/y.png)' })).not.toContain(
      '![x]',
    );
  });

  const summary = (over: Partial<QuizSummary>): QuizSummary => ({
    correct: 0,
    partly: 0,
    revealed: 0,
    skipped: 0,
    total: 3,
    toReview: [],
    results: [],
    ...over,
  });

  it('cheers a perfect score and lists concepts to review otherwise', () => {
    expect(summaryMarkdown(summary({ correct: 3 }))).toContain('Perfect! 3/3 correct');
    const mixed = summaryMarkdown(
      summary({ correct: 1, partly: 1, revealed: 1, toReview: ['closures'] }),
    );
    expect(mixed).toContain('Nice work: 1/2 correct, 1 partly');
    expect(mixed).toContain('(peeked at 1)');
    expect(mixed).toContain('&nbsp;closures&nbsp;');
  });

  it('does not call peeking at every answer a failure', () => {
    const md = summaryMarkdown(summary({ revealed: 2, skipped: 1 }));

    expect(md).toContain('No answers this round');
    expect(md).not.toMatch(/0\/\d correct/);
    expect(md).not.toContain('miss');
  });
});

describe('ReportStore', () => {
  it('appends one JSON line per report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'patch-tutor-reports-'));
    try {
      const store = new ReportStore(join(dir, 'nested', 'reports.jsonl'));
      const report = {
        reportedAt: '2026-10-11T00:00:00.000Z',
        filePath: 'a.js',
        hunkId: 'h',
        diff: '@@',
        model: 'vscodeLm:default',
        explainPromptVersion: 'v1',
        comments: ['wrong!'],
      };

      await store.add(report);
      await store.add({ ...report, hunkId: 'h2' });

      const lines = readFileSync(store.filePath, 'utf8').trim().split('\n');
      expect(lines.map((l) => (JSON.parse(l) as { hunkId: string }).hunkId)).toEqual(['h', 'h2']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('QuizService', () => {
  const hunk: Hunk = {
    id: 'h1',
    filePath: 'a.js',
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

  function serviceReplying(...replies: string[]) {
    const complete = vi.fn<LLMProvider['complete']>();
    replies.forEach((r) => complete.mockResolvedValueOnce(r));
    const service = new QuizService({
      createProvider: () => ({ id: 'vscodeLm', name: 'fake', complete }),
      buildContext: async () => context,
      maxOutputTokens: () => 800,
    });
    return { service, complete };
  }

  it('asks for a quiz with the quiz prompt, keeps 3 questions and fills missing ids', async () => {
    const questions = [1, 2, 3, 4].map((n) => ({ ...question(n), id: undefined }));
    const { service, complete } = serviceReplying(JSON.stringify({ questions }));

    const result = await service.createQuiz(hunk);

    expect(result.ok && result.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(result.ok && result.diff).toBe(hunk.raw);
    expect(complete.mock.calls[0]?.[0].system).toBe(quizPrompt);
    expect(complete.mock.calls[0]?.[0].user).toContain('```diff\n@@ -1 +1 @@\n+x');
  });

  it('reports a quiz that never validates', async () => {
    const { service } = serviceReplying('no', 'still no');

    expect(await service.createQuiz(hunk)).toMatchObject({ ok: false });
  });

  it('grades with the question, reference answer, diff and trimmed answer', async () => {
    const { service, complete } = serviceReplying(
      JSON.stringify({ verdict: 'correct', feedback: 'Yes.', missed: [], remember: 'R.' }),
    );

    const result = await service.grade(question(1), '  it returns 1  ', hunk.raw);

    expect(result).toMatchObject({ ok: true, grade: { verdict: 'correct' } });
    const request = complete.mock.calls[0]?.[0];
    expect(request?.system).toBe(gradePrompt);
    expect(request?.user).toContain('What does `f(1)` return?');
    expect(request?.user).toContain('It returns 1.');
    expect(request?.user).toContain("## The developer's answer\n\nit returns 1");
    expect(request?.user).toContain('+x');
  });
});
