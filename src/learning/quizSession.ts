import type { Question, Verdict } from '../llm/schemas';

export type Outcome = Verdict | 'skipped' | 'revealed' | 'ungraded';

export interface QuestionResult {
  question: Question;
  outcome: Outcome;
}

export interface QuizSummary {
  correct: number;
  partly: number;
  total: number;
  /** Concepts from questions that were not answered correctly. */
  toReview: string[];
  results: QuestionResult[];
}

/** Progress through one quiz: which question is current and how each went. Pure state. */
export class QuizSession {
  private readonly results: QuestionResult[] = [];

  constructor(readonly questions: readonly Question[]) {}

  get index(): number {
    return this.results.length;
  }

  get current(): Question | undefined {
    return this.questions[this.index];
  }

  get done(): boolean {
    return this.index >= this.questions.length;
  }

  /** Records the outcome of the current question and moves to the next. */
  record(outcome: Outcome): QuestionResult {
    const question = this.current;
    if (!question) {
      throw new Error('The quiz is already finished.');
    }
    const result = { question, outcome };
    this.results.push(result);
    return result;
  }

  summary(): QuizSummary {
    const count = (o: Outcome) => this.results.filter((r) => r.outcome === o).length;
    const toReview = [
      ...new Set(
        this.results.filter((r) => r.outcome !== 'correct').map((r) => r.question.concept),
      ),
    ];
    return {
      correct: count('correct'),
      partly: count('partly'),
      total: this.questions.length,
      toReview,
      results: [...this.results],
    };
  }
}
