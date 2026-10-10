import * as vscode from 'vscode';
import type { ReportStore } from '../learning/reports';
import { EXPLAIN_PROMPT_VERSION } from '../services/explainService';
import type { HunkService } from '../services/hunkService';
import type { ChatView } from './chat/chatView';
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
  reports: ReportStore,
  chat: ChatView,
  modelKey: () => string,
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
    vscode.commands.registerCommand(
      'patchTutor.thread.reportWrong',
      async (thread: vscode.CommentThread) => {
        const entry = threads.find(thread);
        if (!entry) {
          return;
        }
        await reports.add({
          reportedAt: new Date().toISOString(),
          filePath: entry.hunk.filePath,
          hunkId: entry.hunk.id,
          diff: entry.hunk.raw,
          model: modelKey(),
          explainPromptVersion: EXPLAIN_PROMPT_VERSION,
          comments: thread.comments.map((c) =>
            typeof c.body === 'string' ? c.body : c.body.value,
          ),
        });
        threads.addNote(
          entry,
          '🙏 **Thanks for flagging this.** Saved to your local Patch Tutor reports so the prompts can be improved; nothing is sent anywhere. When the tutor and the code disagree, trust the code.',
        );
      },
    ),
    vscode.commands.registerCommand('patchTutor.openReports', async () => {
      try {
        await vscode.window.showTextDocument(vscode.Uri.file(reports.filePath));
      } catch {
        void vscode.window.showInformationMessage('Patch Tutor: No reports yet.');
      }
    }),
    vscode.commands.registerCommand('patchTutor.quiz.submit', (reply: vscode.CommentReply) =>
      quizzes.submit(reply),
    ),
    vscode.commands.registerCommand('patchTutor.quiz.skip', (reply: vscode.CommentReply) =>
      quizzes.skip(reply),
    ),
    vscode.commands.registerCommand('patchTutor.quiz.showAnswer', (reply: vscode.CommentReply) =>
      quizzes.showAnswer(reply),
    ),
    // From the reply box the argument is a CommentReply; from the title bar, the thread.
    vscode.commands.registerCommand(
      'patchTutor.quiz.moveToChat',
      async (target: vscode.CommentReply | vscode.CommentThread) => {
        const thread = 'thread' in target ? target.thread : target;
        const entry = threads.find(thread);
        const quiz = entry && threads.moveQuizToChat(entry);
        if (quiz) {
          await chat.adopt(quiz, thread.uri);
        }
      },
    ),
  );
}
