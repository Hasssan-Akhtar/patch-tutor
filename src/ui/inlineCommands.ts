import * as vscode from 'vscode';
import type { HunkService } from '../services/hunkService';
import type { InlineComments } from './comments';
import type { QuizThreads } from './quizThreads';
import type { ThreadRegistry } from './threads';

type HunkTarget = vscode.Uri | string;

export function registerInlineCommands(
  context: vscode.ExtensionContext,
  hunks: HunkService,
  threads: ThreadRegistry,
  comments: InlineComments,
  quizzes: QuizThreads,
): void {
  // Hover links pass the URI as a string; CodeLens passes a Uri.
  const locate = async (target: HunkTarget, hunkId: string) => {
    const uri = typeof target === 'string' ? vscode.Uri.parse(target) : target;
    const located = await hunks.findHunk(uri, hunkId);
    if (!located) {
      void vscode.window.showWarningMessage(
        'Patch Tutor: This change has moved. Save the file to refresh, then try again.',
      );
    }
    return located && { uri, located };
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'patchTutor.explainHunk',
      async (target: HunkTarget, id: string) => {
        const found = await locate(target, id);
        if (found) {
          await comments.explain(found.uri, found.located);
        }
      },
    ),
    vscode.commands.registerCommand(
      'patchTutor.quizHunk',
      async (target: HunkTarget, id: string) => {
        const found = await locate(target, id);
        if (found) {
          await quizzes.start(found.uri, found.located);
        }
      },
    ),
    vscode.commands.registerCommand('patchTutor.thread.deeper', (thread: vscode.CommentThread) =>
      comments.changeDepth(thread, 'deeper'),
    ),
    vscode.commands.registerCommand('patchTutor.thread.simpler', (thread: vscode.CommentThread) =>
      comments.changeDepth(thread, 'simpler'),
    ),
    vscode.commands.registerCommand('patchTutor.thread.quiz', (thread: vscode.CommentThread) =>
      quizzes.startForThread(thread),
    ),
    vscode.commands.registerCommand('patchTutor.thread.dismiss', (thread: vscode.CommentThread) =>
      threads.close(thread),
    ),
    vscode.commands.registerCommand('patchTutor.quiz.submit', (reply: vscode.CommentReply) =>
      quizzes.submit(reply),
    ),
    vscode.commands.registerCommand('patchTutor.quiz.skip', (reply: vscode.CommentReply) =>
      quizzes.skip(reply),
    ),
    vscode.commands.registerCommand('patchTutor.quiz.showAnswer', (reply: vscode.CommentReply) =>
      quizzes.showAnswer(reply),
    ),
  );
}
