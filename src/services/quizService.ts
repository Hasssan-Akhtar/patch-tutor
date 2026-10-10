import type { Hunk } from '../git/hunk';
import type { LLMProvider } from '../llm/provider';
import { GradeSchema, QuizSchema, type Grade, type Question } from '../llm/schemas';
import { completeStructured } from '../llm/structured';
import gradePrompt from '../prompts/grade.md';
import gradeUserPrompt from '../prompts/grade-user.md';
import quizPrompt from '../prompts/quiz.md';
import quizUserPrompt from '../prompts/quiz-user.md';
import { renderTemplate } from '../prompts/render';
import { hunkPromptValues, type HunkContext } from './explainService';

const QUESTIONS_PER_QUIZ = 3;

export interface QuizDeps {
  createProvider: () => LLMProvider;
  buildContext: (
    hunk: Hunk,
    repoRoot: string | undefined,
    signal?: AbortSignal,
  ) => Promise<HunkContext>;
  maxOutputTokens: () => number;
}

export type QuizResult =
  { ok: true; questions: Question[]; diff: string } | { ok: false; error: string };

export type GradeResult = { ok: true; grade: Grade } | { ok: false; raw: string };

/** Writes quizzes about a hunk and grades answers. Quizzes are not cached, so each run is fresh. */
export class QuizService {
  constructor(private readonly deps: QuizDeps) {}

  async createQuiz(
    hunk: Hunk,
    options: { repoRoot?: string; signal?: AbortSignal; previousQuestions?: string[] } = {},
  ): Promise<QuizResult> {
    const context = await this.deps.buildContext(hunk, options.repoRoot, options.signal);
    const previous = options.previousQuestions ?? [];
    const result = await completeStructured(
      this.deps.createProvider(),
      {
        system: quizPrompt,
        user: renderTemplate(quizUserPrompt, {
          ...hunkPromptValues(hunk, context),
          previousQuestions:
            previous.length > 0 ? previous.map((q) => `- ${q}`).join('\n') : '(none yet)',
        }),
        maxTokens: this.deps.maxOutputTokens(),
        signal: options.signal,
      },
      QuizSchema,
    );
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    const questions = result.value.questions
      .slice(0, QUESTIONS_PER_QUIZ)
      .map((q, i) => ({ ...q, id: q.id ?? `q${i + 1}` }));
    return { ok: true, questions, diff: context.diff };
  }

  async grade(
    question: Question,
    answer: string,
    diff: string,
    signal?: AbortSignal,
  ): Promise<GradeResult> {
    const result = await completeStructured(
      this.deps.createProvider(),
      {
        system: gradePrompt,
        user: renderTemplate(gradeUserPrompt, {
          diff,
          type: question.type,
          concept: question.concept,
          question: question.question,
          expected: question.expected,
          answer: answer.trim(),
        }),
        maxTokens: this.deps.maxOutputTokens(),
        signal,
      },
      GradeSchema,
    );
    return result.ok ? { ok: true, grade: result.value } : { ok: false, raw: result.raw };
  }
}
