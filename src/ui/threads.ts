import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import type { QuizSession } from '../learning/quizSession';
import { ProviderError } from '../llm/provider';
import type { Depth } from '../llm/schemas';
import { hunkRange } from './hunkRange';

export interface QuizState {
  session: QuizSession;
  /** The diff the questions were written from, sent again for grading. */
  diff: string;
  comments: vscode.Comment[];
  controller: AbortController;
  /** True while waiting for the model; replies are ignored meanwhile. */
  busy: boolean;
}

export interface ThreadEntry {
  thread: vscode.CommentThread;
  hunk: Hunk;
  repoRoot: string;
  depth: Depth;
  title: string;
  explanation?: vscode.Comment;
  explainController?: AbortController;
  quiz?: QuizState;
}

export const DEFAULT_TITLE = '💡 Patch Tutor';

/**
 * Owns the Patch Tutor comment threads: one per hunk, holding an optional
 * explanation followed by an optional quiz. `render` is the only place that
 * writes thread state, so the explanation and quiz flows never clobber each other.
 */
export class ThreadRegistry implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController(
    'patch-tutor',
    'Patch Tutor',
  );
  private readonly entries = new Map<string, ThreadEntry>();
  private readonly tutor: vscode.CommentAuthorInformation;
  private readonly you: vscode.CommentAuthorInformation = { name: 'You' };

  constructor(extensionUri: vscode.Uri) {
    this.tutor = {
      name: 'Patch Tutor',
      iconPath: vscode.Uri.joinPath(extensionUri, 'media', 'avatar.svg'),
    };
    this.controller.options = {
      prompt: 'Answer the question…',
      placeHolder: 'Type your answer. Short is fine.',
    };
  }

  async getOrCreate(
    uri: vscode.Uri,
    located: { hunk: Hunk; repoRoot: string },
  ): Promise<ThreadEntry> {
    const key = `${uri.toString()}#${located.hunk.id}`;
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const thread = this.controller.createCommentThread(uri, hunkRange(located.hunk, document), []);
    const entry: ThreadEntry = { thread, ...located, depth: 'standard', title: DEFAULT_TITLE };
    this.entries.set(key, entry);
    return entry;
  }

  find(thread: vscode.CommentThread): ThreadEntry | undefined {
    return [...this.entries.values()].find((e) => e.thread === thread);
  }

  threadsFor(uri: vscode.Uri): readonly vscode.CommentThread[] {
    return [...this.entries.values()]
      .map((e) => e.thread)
      .filter((t) => t.uri.toString() === uri.toString());
  }

  /** Writes an entry's comments, title, buttons and reply box to its thread. */
  render(entry: ThreadEntry): void {
    const { thread, quiz } = entry;
    const quizOpen =
      !!quiz && !quiz.session.done && !quiz.busy && quiz.session.questions.length > 0;
    thread.label = entry.title;
    thread.comments = [
      ...(entry.explanation ? [entry.explanation] : []),
      ...(quiz?.comments ?? []),
    ];
    thread.contextValue = `patchTutorThread ${entry.depth}${quizOpen ? ' quiz' : ''}`;
    thread.canReply = quizOpen;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }

  close(thread: vscode.CommentThread): void {
    for (const [key, entry] of this.entries) {
      if (entry.thread === thread) {
        entry.explainController?.abort();
        entry.quiz?.controller.abort();
        this.entries.delete(key);
      }
    }
    thread.dispose();
  }

  tutorComment(markdownText: string): vscode.Comment {
    return {
      body: tutorMarkdown(markdownText),
      mode: vscode.CommentMode.Preview,
      author: this.tutor,
    };
  }

  userComment(text: string): vscode.Comment {
    return {
      body: new vscode.MarkdownString().appendText(text),
      mode: vscode.CommentMode.Preview,
      author: this.you,
    };
  }

  errorComment(error: unknown, what: string): vscode.Comment {
    return {
      body: errorMarkdown(error, what),
      mode: vscode.CommentMode.Preview,
      author: this.tutor,
    };
  }

  dispose(): void {
    this.entries.forEach((e) => {
      e.explainController?.abort();
      e.quiz?.controller.abort();
    });
    this.controller.dispose();
  }
}

function tutorMarkdown(text: string): vscode.MarkdownString {
  // Theme icons and inline color spans. Model text is escaped by the *Markdown
  // helpers, and the string is never trusted to run commands.
  const md = new vscode.MarkdownString(text, true);
  md.supportHtml = true;
  return md;
}

function errorMarkdown(error: unknown, what: string): vscode.MarkdownString {
  if (error instanceof ProviderError && error.kind === 'cancelled') {
    return new vscode.MarkdownString('Cancelled.');
  }
  const message = error instanceof Error ? error.message : String(error);
  const md = new vscode.MarkdownString(
    `😕 **Couldn't ${what}.** ${message}\n\n[Test connection](command:patchTutor.testConnection) · [Choose provider](command:patchTutor.chooseProvider)`,
    true,
  );
  // Only our own two commands may run from this message.
  md.isTrusted = { enabledCommands: ['patchTutor.testConnection', 'patchTutor.chooseProvider'] };
  return md;
}
