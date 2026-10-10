import * as vscode from 'vscode';
import type { HunkService } from '../services/hunkService';
import type { InlineComments } from './comments';

export function registerInlineCommands(
  context: vscode.ExtensionContext,
  hunks: HunkService,
  comments: InlineComments,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'patchTutor.explainHunk',
      async (uri: vscode.Uri, hunkId: string) => {
        const located = await hunks.findHunk(uri, hunkId);
        if (!located) {
          void vscode.window.showWarningMessage(
            'Patch Tutor: This change has moved. Save the file to refresh, then try again.',
          );
          return;
        }
        await comments.explain(uri, located);
      },
    ),
    vscode.commands.registerCommand('patchTutor.quizHunk', showQuizComingSoon),
    vscode.commands.registerCommand('patchTutor.thread.deeper', (thread: vscode.CommentThread) =>
      comments.changeDepth(thread, 'deeper'),
    ),
    vscode.commands.registerCommand('patchTutor.thread.simpler', (thread: vscode.CommentThread) =>
      comments.changeDepth(thread, 'simpler'),
    ),
    vscode.commands.registerCommand('patchTutor.thread.quiz', showQuizComingSoon),
    vscode.commands.registerCommand('patchTutor.thread.dismiss', (thread: vscode.CommentThread) =>
      comments.dismiss(thread),
    ),
  );
}

// Placeholder until quizzes land (Phase 5).
function showQuizComingSoon(): void {
  void vscode.window.showInformationMessage('Patch Tutor: Quizzes are coming in the next version.');
}
