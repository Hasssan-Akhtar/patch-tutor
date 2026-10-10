import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import { changedLineRange } from '../context/hunkLines';
import type { QuizHistory } from '../learning/quizHistory';
import type { Transcript, TranscriptStore } from '../learning/transcripts';
import type { QuizService } from '../services/quizService';
import { QuizRun, type AnsweredQuestion } from './quizRun';
import type { ThreadEntry, ThreadRegistry } from './threads';

export type { AnsweredQuestion } from './quizRun';

/**
 * Starts quizzes and routes the thread's reply-box buttons to them. The quiz
 * logic lives in QuizRun so the same quiz can continue in the chat view.
 */
export class QuizThreads implements vscode.Disposable {
  private readonly answered = new vscode.EventEmitter<AnsweredQuestion>();
  /** Fires as each question is answered, revealed or skipped, wherever the quiz is shown. */
  readonly onDidAnswer = this.answered.event;

  constructor(
    private readonly threads: ThreadRegistry,
    private readonly quizService: QuizService,
    private readonly history: QuizHistory,
    private readonly transcripts: TranscriptStore,
  ) {}

  /** A new quiz on a hunk, not yet started or shown anywhere. */
  createRun(hunk: Hunk, repoRoot: string): QuizRun {
    const run = new QuizRun(hunk, repoRoot, {
      quizService: this.quizService,
      history: this.history,
      onAnswer: (a) => this.answered.fire(a),
    });
    // Save the conversation whenever it settles, so History has it even if abandoned.
    run.onDidChange(() => {
      if (!run.busy && run.questionCount > 0) {
        void this.transcripts.save(toTranscript(run));
      }
    });
    return run;
  }

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
    const quiz = this.threads.find(reply.thread)?.quiz;
    if (quiz && (await quiz.submit(reply.text)) === 'empty') {
      void vscode.window.showInformationMessage(
        'Patch Tutor: Type an answer first, or use Skip or Show answer.',
      );
    }
  }

  skip(reply: vscode.CommentReply): void {
    this.threads.find(reply.thread)?.quiz?.skip();
  }

  showAnswer(reply: vscode.CommentReply): void {
    this.threads.find(reply.thread)?.quiz?.reveal();
  }

  dispose(): void {
    this.answered.dispose();
  }

  private async run(entry: ThreadEntry): Promise<void> {
    const quiz = this.createRun(entry.hunk, entry.repoRoot);
    this.threads.attachQuiz(entry, quiz);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'Patch Tutor: writing a quiz…' },
      () => quiz.start(),
    );
  }
}

export function toTranscript(run: QuizRun): Transcript {
  const summary = run.summary();
  return {
    id: run.id,
    startedAt: run.startedAt,
    updatedAt: Date.now(),
    filePath: run.hunk.filePath,
    line: changedLineRange(run.hunk).start,
    done: run.done,
    correct: summary.correct,
    partly: summary.partly,
    revealed: summary.revealed,
    skipped: summary.skipped,
    total: summary.total,
    questions: summary.results.map((r) => r.question.question).concat(run.pendingQuestions),
    messages: run.messages.filter((m) => !m.pending).map(({ from, text }) => ({ from, text })),
  };
}
