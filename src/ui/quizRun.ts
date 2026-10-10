import type { Hunk } from '../git/hunk';
import type { QuizHistory } from '../learning/quizHistory';
import { QuizSession, type Outcome } from '../learning/quizSession';
import type { Question } from '../llm/schemas';
import type { QuizService } from '../services/quizService';
import { escapeModelText } from './markdownStyle';
import {
  gradeMarkdown,
  questionMarkdown,
  quizErrorMarkdown,
  revealMarkdown,
  skipMarkdown,
  summaryMarkdown,
  ungradedMarkdown,
} from './quizMarkdown';

export interface QuizMessage {
  from: 'tutor' | 'you';
  /** Markdown for tutor messages; the plain text typed for your answers. */
  text: string;
  /** A placeholder shown while waiting for the model. */
  pending?: boolean;
}

export interface AnsweredQuestion {
  hunk: Hunk;
  question: Question;
  outcome: Outcome;
}

export interface QuizRunDeps {
  quizService: QuizService;
  history: QuizHistory;
  onAnswer: (answered: AnsweredQuestion) => void;
}

export type SubmitResult = 'graded' | 'empty' | 'not-ready' | 'failed';

/**
 * One quiz on one hunk: writes the questions, grades answers and keeps a
 * transcript. It knows nothing about where it is shown, so the comment thread
 * and the chat view are both just renderings of `messages`.
 */
export class QuizRun {
  private readonly listeners = new Set<() => void>();
  private readonly controller = new AbortController();
  private session = new QuizSession([]);
  private diff = '';
  private started = false;

  readonly messages: QuizMessage[] = [];
  busy = false;

  constructor(
    readonly hunk: Hunk,
    readonly repoRoot: string,
    private readonly deps: QuizRunDeps,
  ) {}

  /** True when a question is waiting for an answer. */
  get canAnswer(): boolean {
    return !this.busy && !!this.session.current;
  }

  /** True once the summary has been shown, or writing the quiz failed. */
  get done(): boolean {
    return this.started && !this.busy && !this.session.current;
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async start(): Promise<void> {
    this.started = true;
    this.busy = true;
    this.messages.push({ from: 'tutor', text: 'Writing a few questions for you…', pending: true });
    this.changed();

    try {
      const result = await this.deps.quizService.createQuiz(this.hunk, {
        repoRoot: this.repoRoot,
        signal: this.controller.signal,
        previousQuestions: this.deps.history.previous(this.hunk.id),
      });
      this.messages.pop();
      if (result.ok) {
        await this.deps.history.record(
          this.hunk.id,
          result.questions.map((q) => q.question),
        );
        this.session = new QuizSession(result.questions);
        this.diff = result.diff;
        this.messages.push({ from: 'tutor', text: this.next() });
      } else {
        this.messages.push({ from: 'tutor', text: quizErrorMarkdown(result.error) });
      }
    } catch (error) {
      if (this.cancelled) {
        return;
      }
      this.messages.pop();
      this.messages.push({ from: 'tutor', text: failure('write a quiz', error) });
    }
    this.busy = false;
    this.changed();
  }

  async submit(text: string): Promise<SubmitResult> {
    const question = this.session.current;
    if (!this.canAnswer || !question) {
      return 'not-ready';
    }
    const answer = text.trim();
    if (!answer) {
      return 'empty';
    }

    this.messages.push(
      { from: 'you', text: answer },
      { from: 'tutor', text: 'Checking your answer…', pending: true },
    );
    this.busy = true;
    this.changed();

    let result: SubmitResult = 'graded';
    try {
      const graded = await this.deps.quizService.grade(
        question,
        answer,
        this.diff,
        this.controller.signal,
      );
      this.messages.pop();
      if (graded.ok) {
        this.record(graded.grade.verdict);
        this.messages.push({
          from: 'tutor',
          text: this.withNext(gradeMarkdown(graded.grade, question)),
        });
      } else {
        this.record('ungraded');
        this.messages.push({
          from: 'tutor',
          text: this.withNext(ungradedMarkdown(graded.raw, question)),
        });
      }
    } catch (error) {
      if (this.cancelled) {
        return 'failed';
      }
      // Keep the question open so the answer can be sent again.
      this.messages.pop();
      this.messages.push({ from: 'tutor', text: failure('check your answer', error) });
      result = 'failed';
    }
    this.busy = false;
    this.changed();
    return result;
  }

  skip(): void {
    this.giveUp('skipped');
  }

  reveal(): void {
    this.giveUp('revealed');
  }

  cancel(): void {
    this.controller.abort();
    this.listeners.clear();
  }

  private giveUp(outcome: 'skipped' | 'revealed'): void {
    const question = this.session.current;
    if (!this.canAnswer || !question) {
      return;
    }
    this.record(outcome);
    const feedback = outcome === 'skipped' ? skipMarkdown(question) : revealMarkdown(question);
    this.messages.push({ from: 'tutor', text: this.withNext(feedback) });
    this.changed();
  }

  private record(outcome: Outcome): void {
    const { question } = this.session.record(outcome);
    this.deps.onAnswer({ hunk: this.hunk, question, outcome });
  }

  /** Feedback on the last question, then the next question or the summary, as one message. */
  private withNext(feedback: string): string {
    return `${feedback}\n\n---\n\n${this.next()}`;
  }

  private next(): string {
    const question = this.session.current;
    return question
      ? questionMarkdown(question, this.session.index, this.session.questions.length)
      : summaryMarkdown(this.session.summary());
  }

  private changed(): void {
    this.listeners.forEach((listener) => listener());
  }
}

function failure(what: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `😕 **Couldn't ${what}.** ${escapeModelText(message)}\n\nCheck **Patch Tutor: Test connection**, then try again.`;
}
