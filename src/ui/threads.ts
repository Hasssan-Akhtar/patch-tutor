import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import { ProviderError } from '../llm/provider';
import type { Depth, Explanation } from '../llm/schemas';
import type { ExplanationChat } from './explanationChat';
import { hunkRange } from './hunkRange';
import type { QuizMessage, QuizRun } from './quizRun';

export interface ThreadEntry {
  thread: vscode.CommentThread;
  hunk: Hunk;
  repoRoot: string;
  depth: Depth;
  title: string;
  explanation?: vscode.Comment;
  explainController?: AbortController;
  quiz?: QuizRun;
  /** Set when the quiz was moved to the chat view; the thread then shows a pointer instead. */
  quizInChat?: boolean;
  /** The explanation shown, when it parsed; follow-up chat needs it. */
  explained?: Explanation;
  chat?: ExplanationChat;
  /** Set when the chat was moved to the chat view; the thread then shows a pointer instead. */
  chatInChat?: boolean;
  /** Short messages appended after everything else, e.g. thanks for a report. */
  notes?: vscode.Comment[];
}

const MOVED_TO_CHAT =
  '💬 **This quiz continues in the Patch Tutor chat** in the sidebar. Your answers so far moved with it.';

const CHAT_MOVED_TO_CHAT =
  '💬 **This conversation continues in the Patch Tutor chat** in the sidebar.';

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
      iconPath: vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg'),
    };
    this.controller.options = {
      prompt: 'Answer the quiz or ask a follow-up…',
      placeHolder: 'Ask about this change, or answer the quiz question.',
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
    const { thread, quiz, chat } = entry;
    const inThread = !!quiz && !entry.quizInChat;
    // " quiz" enables Move to chat and the reply-box buttons while a quiz is in progress here.
    const active = inThread && !quiz.done;
    let quizComments: vscode.Comment[] = [];
    if (quiz) {
      quizComments = inThread
        ? quiz.messages.map((m) => this.messageComment(m))
        : [this.tutorComment(MOVED_TO_CHAT)];
    }
    let chatComments: vscode.Comment[] = [];
    if (chat) {
      chatComments = entry.chatInChat
        ? [this.tutorComment(CHAT_MOVED_TO_CHAT)]
        : chat.messages.map((m) => this.messageComment(m));
    }
    // Follow-ups need a parsed explanation, and wait while a quiz is taking answers here.
    const canChat = !!entry.explained && !active && !entry.chatInChat;
    let mode = '';
    if (active) {
      mode = ' quiz';
    } else if (canChat) {
      mode = chat && chat.messages.length > 0 ? ' chat started' : ' chat';
    }
    thread.label = entry.title;
    thread.comments = [
      ...(entry.explanation ? [entry.explanation] : []),
      ...chatComments,
      ...quizComments,
      ...(entry.notes ?? []),
    ];
    thread.contextValue = `patchTutorThread ${entry.depth}${mode}`;
    thread.canReply = active ? quiz.canAnswer : canChat && !chat?.busy;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }

  /** Points an entry at a new quiz, re-rendering whenever the quiz changes. */
  attachQuiz(entry: ThreadEntry, quiz: QuizRun): void {
    entry.quiz?.cancel();
    entry.quiz = quiz;
    entry.quizInChat = false;
    quiz.onDidChange(() => {
      if (entry.quiz === quiz) {
        this.render(entry);
      }
    });
    this.render(entry);
  }

  /** Hands the entry's quiz to the chat; the thread keeps a pointer to it. */
  moveQuizToChat(entry: ThreadEntry): QuizRun | undefined {
    if (!entry.quiz || entry.quizInChat) {
      return undefined;
    }
    entry.quizInChat = true;
    this.render(entry);
    return entry.quiz;
  }

  /** Points an entry at a new follow-up chat, re-rendering whenever it changes. */
  attachChat(entry: ThreadEntry, chat: ExplanationChat): void {
    this.resetChat(entry);
    entry.chat = chat;
    chat.onDidChange(() => {
      if (entry.chat === chat) {
        this.render(entry);
      }
    });
    // A chat that moved to the chat view ends there when something replaces it;
    // the thread then takes follow-ups again.
    chat.onDidCancel(() => {
      if (entry.chat === chat && entry.chatInChat && this.isOpen(entry)) {
        entry.chat = undefined;
        entry.chatInChat = false;
        this.render(entry);
      }
    });
    this.render(entry);
  }

  /** Hands the entry's chat to the chat view; the thread keeps a pointer to it. */
  moveChatToChat(entry: ThreadEntry): ExplanationChat | undefined {
    if (!entry.chat || entry.chatInChat || entry.chat.messages.length === 0) {
      return undefined;
    }
    entry.chatInChat = true;
    this.render(entry);
    return entry.chat;
  }

  /** Drops the entry's chat; one that moved to the chat view keeps going there. */
  resetChat(entry: ThreadEntry): void {
    if (entry.chat && !entry.chatInChat) {
      entry.chat.cancel();
    }
    entry.chat = undefined;
    entry.chatInChat = false;
  }

  private isOpen(entry: ThreadEntry): boolean {
    return [...this.entries.values()].includes(entry);
  }

  private messageComment(message: QuizMessage): vscode.Comment {
    if (message.from === 'you') {
      return this.userComment(message.text);
    }
    return this.tutorComment(message.pending ? `$(loading~spin) ${message.text}` : message.text);
  }

  addNote(entry: ThreadEntry, markdownText: string): void {
    entry.notes = [...(entry.notes ?? []), this.tutorComment(markdownText)];
    this.render(entry);
  }

  close(thread: vscode.CommentThread): void {
    for (const [key, entry] of this.entries) {
      if (entry.thread === thread) {
        entry.explainController?.abort();
        // A quiz that moved to the chat keeps going there.
        if (!entry.quizInChat) {
          entry.quiz?.cancel();
        }
        if (!entry.chatInChat) {
          entry.chat?.cancel();
        }
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
      if (!e.quizInChat) {
        e.quiz?.cancel();
      }
      if (!e.chatInChat) {
        e.chat?.cancel();
      }
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
