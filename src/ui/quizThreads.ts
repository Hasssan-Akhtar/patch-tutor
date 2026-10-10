import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import type { QuizHistory } from '../learning/quizHistory';
import { QuizSession, type Outcome } from '../learning/quizSession';
import type { Question } from '../llm/schemas';
import type { QuizService } from '../services/quizService';
import {
  gradeMarkdown,
  questionMarkdown,
  quizErrorMarkdown,
  revealMarkdown,
  skipMarkdown,
  summaryMarkdown,
  ungradedMarkdown,
} from './quizMarkdown';
import type { QuizState, ThreadEntry, ThreadRegistry } from './threads';

/** The quiz part of a Patch Tutor thread: questions, answers in the reply box, grades. */
export interface AnsweredQuestion {
  hunk: Hunk;
  question: Question;
  outcome: Outcome;
}

export class QuizThreads {
  private readonly answered = new vscode.EventEmitter<AnsweredQuestion>();
  /** Fires as each question is answered, revealed or skipped, so progress survives an abandoned quiz. */
  readonly onDidAnswer = this.answered.event;

  constructor(
    private readonly threads: ThreadRegistry,
    private readonly quizService: QuizService,
    private readonly history: QuizHistory,
  ) {}

  async start(uri: vscode.Uri, located: { hunk: Hunk; repoRoot: string }): Promise<void> {
    await this.run(await this.threads.getOrCreate(uri, located));
  }

  async startForThread(thread: vscode.CommentThread): Promise<void> {
    const entry = this.threads.find(thread);
    if (entry) {
      await this.run(entry);
    }
  }

  async submit(reply: vscode.CommentReply): Promise<void> {
    const entry = this.threads.find(reply.thread);
    const quiz = entry?.quiz;
    const question = quiz?.session.current;
    if (!entry || !quiz || quiz.busy || !question) {
      return;
    }
    const answer = reply.text.trim();
    if (!answer) {
      void vscode.window.showInformationMessage(
        'Patch Tutor: Type an answer first, or use Skip or Show answer.',
      );
      return;
    }

    quiz.comments.push(
      this.threads.userComment(answer),
      this.threads.tutorComment('$(loading~spin) Checking your answer…'),
    );
    quiz.busy = true;
    this.threads.render(entry);

    try {
      const result = await this.quizService.grade(
        question,
        answer,
        quiz.diff,
        quiz.controller.signal,
      );
      quiz.comments.pop();
      if (result.ok) {
        this.record(entry, quiz, result.grade.verdict);
        this.advance(quiz, gradeMarkdown(result.grade, question));
      } else {
        this.record(entry, quiz, 'ungraded');
        this.advance(quiz, ungradedMarkdown(result.raw, question));
      }
    } catch (error) {
      if (quiz.controller.signal.aborted) {
        return;
      }
      // Keep the question open so the answer can be sent again.
      quiz.comments.pop();
      quiz.comments.push(this.threads.errorComment(error, 'check your answer'));
    }
    quiz.busy = false;
    this.threads.render(entry);
  }

  skip(reply: vscode.CommentReply): void {
    this.giveUp(reply.thread, 'skipped');
  }

  showAnswer(reply: vscode.CommentReply): void {
    this.giveUp(reply.thread, 'revealed');
  }

  dispose(): void {
    this.answered.dispose();
  }

  private giveUp(thread: vscode.CommentThread, outcome: 'skipped' | 'revealed'): void {
    const entry = this.threads.find(thread);
    const quiz = entry?.quiz;
    const question = quiz?.session.current;
    if (!entry || !quiz || quiz.busy || !question) {
      return;
    }
    this.record(entry, quiz, outcome);
    this.advance(quiz, outcome === 'skipped' ? skipMarkdown(question) : revealMarkdown(question));
    this.threads.render(entry);
  }

  private record(entry: ThreadEntry, quiz: QuizState, outcome: Outcome): void {
    const { question } = quiz.session.record(outcome);
    this.answered.fire({ hunk: entry.hunk, question, outcome });
  }

  /**
   * Posts one comment holding the feedback on the last question (if any) and
   * the next question, or the summary when the quiz is over.
   */
  private advance(quiz: QuizState, feedback?: string): void {
    const next = quiz.session.current;
    const after = next
      ? questionMarkdown(next, quiz.session.index, quiz.session.questions.length)
      : summaryMarkdown(quiz.session.summary());
    quiz.comments.push(
      this.threads.tutorComment(feedback ? `${feedback}\n\n---\n\n${after}` : after),
    );
  }

  private async run(entry: ThreadEntry): Promise<void> {
    entry.quiz?.controller.abort();
    const quiz: QuizState = {
      session: new QuizSession([]),
      diff: '',
      comments: [this.threads.tutorComment('$(loading~spin) Writing a few questions for you…')],
      controller: new AbortController(),
      busy: true,
    };
    entry.quiz = quiz;
    this.threads.render(entry);

    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Patch Tutor: writing a quiz…' },
        () =>
          this.quizService.createQuiz(entry.hunk, {
            repoRoot: entry.repoRoot,
            signal: quiz.controller.signal,
            previousQuestions: this.history.previous(entry.hunk.id),
          }),
      );
      if (result.ok) {
        await this.history.record(
          entry.hunk.id,
          result.questions.map((q) => q.question),
        );
        quiz.session = new QuizSession(result.questions);
        quiz.diff = result.diff;
        quiz.comments = [];
        this.advance(quiz);
      } else {
        quiz.comments = [this.threads.tutorComment(quizErrorMarkdown(result.error))];
      }
    } catch (error) {
      if (quiz.controller.signal.aborted) {
        return;
      }
      quiz.comments = [this.threads.errorComment(error, 'write a quiz')];
    }
    quiz.busy = false;
    if (entry.quiz === quiz) {
      this.threads.render(entry);
    }
  }
}
