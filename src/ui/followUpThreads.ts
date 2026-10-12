import * as vscode from 'vscode';
import type { Explanation } from '../llm/schemas';
import type { FollowUpService } from '../services/followUpService';
import { ExplanationChat } from './explanationChat';
import { explanationMarkdown, threadTitle } from './explanationMarkdown';
import type { ThreadEntry, ThreadRegistry } from './threads';

/**
 * Routes the thread's reply box to a follow-up chat about the explanation,
 * and shows the tutor's corrections in the explanation itself.
 */
export class FollowUpThreads {
  constructor(
    private readonly threads: ThreadRegistry,
    private readonly followUps: FollowUpService,
  ) {}

  async ask(reply: vscode.CommentReply): Promise<void> {
    const entry = this.threads.find(reply.thread);
    if (!entry?.explained || entry.chatInChat) {
      return;
    }
    const chat = entry.chat ?? this.startChat(entry, entry.explained);
    if ((await chat.ask(reply.text)) === 'empty') {
      void vscode.window.showInformationMessage('Patch Tutor: Type a question first.');
    }
  }

  moveToChat(thread: vscode.CommentThread): ExplanationChat | undefined {
    const entry = this.threads.find(thread);
    return entry && this.threads.moveChatToChat(entry);
  }

  private startChat(entry: ThreadEntry, explanation: Explanation): ExplanationChat {
    const chat = new ExplanationChat(
      entry.hunk,
      entry.repoRoot,
      entry.depth,
      explanation,
      this.followUps,
    );
    // Registered before attachChat's listener, so the re-render shows the correction.
    chat.onDidChange(() => {
      if (chat.revised && entry.chat === chat) {
        entry.explained = chat.explanation;
        entry.explanation = this.threads.tutorComment(
          explanationMarkdown(chat.explanation, false, true),
        );
        entry.title = threadTitle(chat.explanation);
      }
    });
    this.threads.attachChat(entry, chat);
    return chat;
  }
}
