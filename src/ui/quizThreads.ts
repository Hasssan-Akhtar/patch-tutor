import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import { QuizSession, type QuizSummary } from '../learning/quizSession';
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
export class QuizThreads {
  private readonly finished = new vscode.EventEmitter<{ hunk: Hunk; summary: QuizSummary }>();
  /** Fires when a quiz ends, with how each question went. */
  readonly onDidFinishQuiz = this.finished.event;

  constructor(
    private readonly threads: ThreadRegistry,
    private readonly quizService: QuizService,
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
        quiz.comments.push(this.threads.tutorComment(gradeMarkdown(result.grade, question)));
        quiz.session.record(result.grade.verdict);
      } else {
        quiz.comments.push(this.threads.tutorComment(ungradedMarkdown(result.raw, question)));
        quiz.session.record('ungraded');
      }
      this.advance(entry, quiz);
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
    this.finished.dispose();
  }

  private giveUp(thread: vscode.CommentThread, outcome: 'skipped' | 'revealed'): void {
    const entry = this.threads.find(thread);
    const quiz = entry?.quiz;
    const question = quiz?.session.current;
    if (!entry || !quiz || quiz.busy || !question) {
      return;
    }
    quiz.comments.push(
      this.threads.tutorComment(
        outcome === 'skipped' ? skipMarkdown(question) : revealMarkdown(question),
      ),
    );
    quiz.session.record(outcome);
    this.advance(entry, quiz);
    this.threads.render(entry);
  }

  /** Posts the next question, or the summary when the quiz is over. */
  private advance(entry: ThreadEntry, quiz: QuizState): void {
    const next = quiz.session.current;
    if (next) {
      quiz.comments.push(
        this.threads.tutorComment(
          questionMarkdown(next, quiz.session.index, quiz.session.questions.length),
        ),
      );
      return;
    }
    const summary = quiz.session.summary();
    quiz.comments.push(this.threads.tutorComment(summaryMarkdown(summary)));
    this.finished.fire({ hunk: entry.hunk, summary });
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
          }),
      );
      if (result.ok) {
        quiz.session = new QuizSession(result.questions);
        quiz.diff = result.diff;
        quiz.comments = [];
        this.advance(entry, quiz);
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
