import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { changedLineRange } from '../../context/hunkLines';
import type { QuizRun } from '../quizRun';
import { chatShellHtml, messageHtml, type ChatState } from './chatHtml';

export const CHAT_VIEW_ID = 'patchTutor.chat';

interface ChatMessage {
  action?: unknown;
  text?: unknown;
}

/**
 * The quiz chat in the Patch Tutor sidebar. It shows one quiz at a time:
 * one moved here from a comment thread, or another round started here.
 */
export class ChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private quiz: QuizRun | undefined;
  private uri: vscode.Uri | undefined;
  private subscription: { dispose(): void } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    /** Starts a fresh quiz on the same hunk for "Another round". */
    private readonly newRound: (previous: QuizRun) => QuizRun,
  ) {}

  /** The quiz currently shown; exposed for tests. */
  get current(): QuizRun | undefined {
    return this.quiz;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    view.webview.html = chatShellHtml({
      nonce: randomBytes(16).toString('base64'),
      cspSource: view.webview.cspSource,
      avatarUri: view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'icon.svg')).toString(),
    });
    view.webview.onDidReceiveMessage((message: ChatMessage) => void this.handle(message));
    view.onDidDispose(() => {
      this.view = undefined;
    });
  }

  /** Shows a quiz here, replacing any previous one, and reveals the chat. */
  async adopt(quiz: QuizRun, uri: vscode.Uri): Promise<void> {
    if (this.quiz && this.quiz !== quiz) {
      this.quiz.cancel();
    }
    this.subscription?.dispose();
    this.quiz = quiz;
    this.uri = uri;
    this.subscription = quiz.onDidChange(() => this.post());
    this.post();
    await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  }

  async submit(text: string): Promise<void> {
    await this.quiz?.submit(text);
  }

  async anotherRound(): Promise<void> {
    if (!this.quiz || !this.uri) {
      return;
    }
    const next = this.newRound(this.quiz);
    await this.adopt(next, this.uri);
    await next.start();
  }

  state(): ChatState {
    const quiz = this.quiz;
    if (!quiz) {
      return { messages: [], canAnswer: false, busy: false, done: false };
    }
    return {
      header: { file: quiz.hunk.filePath, line: changedLineRange(quiz.hunk).start },
      messages: quiz.messages.map(messageHtml),
      canAnswer: quiz.canAnswer,
      busy: quiz.busy,
      done: quiz.done,
    };
  }

  dispose(): void {
    this.subscription?.dispose();
    this.quiz?.cancel();
  }

  private post(): void {
    void this.view?.webview.postMessage({ type: 'state', state: this.state() });
  }

  private async handle(message: ChatMessage): Promise<void> {
    switch (message.action) {
      case 'ready':
        this.post();
        break;
      case 'submit':
        if (typeof message.text === 'string') {
          await this.submit(message.text);
        }
        break;
      case 'skip':
        this.quiz?.skip();
        break;
      case 'reveal':
        this.quiz?.reveal();
        break;
      case 'anotherRound':
        await this.anotherRound();
        break;
      case 'showChange':
        await this.showChange();
        break;
    }
  }

  private async showChange(): Promise<void> {
    if (!this.quiz || !this.uri) {
      return;
    }
    const line = changedLineRange(this.quiz.hunk).start - 1;
    const editor = await vscode.window.showTextDocument(this.uri, { preview: false });
    const position = new vscode.Position(Math.max(line, 0), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }
}
