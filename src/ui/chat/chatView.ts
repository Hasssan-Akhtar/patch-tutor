import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { changedLineRange } from '../../context/hunkLines';
import type { Transcript, TranscriptStore } from '../../learning/transcripts';
import { OPENAI_PRESETS } from '../../llm/openaiCompatible';
import type { ModelInfo, ProviderId } from '../../llm/provider';
import {
  PROVIDERS,
  providerInfo,
  type ProviderService,
  type ProviderSettings,
} from '../../services/providerService';
import { validateUrl } from '../providerCommands';
import type { QuizRun } from '../quizRun';
import {
  chatShellHtml,
  historyItem,
  messageHtml,
  transcriptMeta,
  type ChatState,
} from './chatHtml';

export const CHAT_VIEW_ID = 'patchTutor.chat';

interface ChatMessage {
  action?: unknown;
  text?: unknown;
  tab?: unknown;
  id?: unknown;
  provider?: unknown;
  form?: unknown;
}

/** Settings as typed in the panel; `key` is present only when one was just entered. */
export interface SettingsForm extends ProviderSettings {
  key?: string;
}

export interface SettingsResult {
  ok: boolean;
  text: string;
}

/**
 * The quiz chat in the Patch Tutor sidebar. The Quiz tab shows one live quiz
 * (moved here from a thread, or another round started here); the History tab
 * lists past quizzes and shows their conversations read-only.
 */
export class ChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private quiz: QuizRun | undefined;
  private uri: vscode.Uri | undefined;
  private quizSubscription: { dispose(): void } | undefined;
  private readonly transcriptSubscription: { dispose(): void };
  private tab: ChatState['tab'] = 'quiz';
  private viewing: Transcript | undefined;
  private history: Transcript[] = [];
  private readonly providerSubscription: vscode.Disposable;
  /** Which providers have a stored key; refreshed whenever settings or keys change. */
  private keySaved: Partial<Record<ProviderId, boolean>> = {};
  private settingsVersion = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly transcripts: TranscriptStore,
    private readonly providers: ProviderService,
    /** Starts a fresh quiz on the same hunk for "Another round". */
    private readonly newRound: (previous: QuizRun) => QuizRun,
  ) {
    this.transcriptSubscription = transcripts.onDidChange(() => void this.reloadHistory());
    this.providerSubscription = providers.onDidChange(() => void this.reloadSettings());
    void this.reloadHistory();
    void this.reloadSettings();
  }

  /** Opens the model settings screen and reveals the chat. */
  async openSettings(): Promise<void> {
    this.showTab('settings');
    await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  }

  async loadModels(form: SettingsForm): Promise<{ models: ModelInfo[]; error?: string }> {
    const invalid = invalidForm(form);
    if (invalid) {
      return { models: [], error: invalid };
    }
    try {
      return { models: await this.providers.listModels(form, form.key) };
    } catch (error) {
      return { models: [], error: messageOf(error) };
    }
  }

  async testSettings(form: SettingsForm): Promise<SettingsResult> {
    const invalid = invalidForm(form);
    if (invalid) {
      return { ok: false, text: invalid };
    }
    try {
      const result = await this.providers.testConnection(form, form.key);
      return {
        ok: true,
        text: `✓ Connected to ${result.providerName} (${result.model}) in ${result.elapsedMs} ms.`,
      };
    } catch (error) {
      return { ok: false, text: `✗ ${messageOf(error)}` };
    }
  }

  /** Stores a newly typed key in secret storage, then saves the rest to settings. */
  async saveSettings(form: SettingsForm): Promise<SettingsResult> {
    const invalid = invalidForm(form);
    if (invalid) {
      return { ok: false, text: invalid };
    }
    if (form.key) {
      await this.providers.setKey(form.provider, form.key);
    }
    await this.providers.save({
      provider: form.provider,
      model: form.model,
      baseUrl: form.baseUrl,
    });
    await this.reloadSettings();
    return { ok: true, text: `✓ Saved. Patch Tutor now uses ${this.providers.label()}.` };
  }

  /** The live quiz; exposed for tests. */
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

  /** Shows a quiz on the Quiz tab, replacing any previous one, and reveals the chat. */
  async adopt(quiz: QuizRun, uri: vscode.Uri): Promise<void> {
    if (this.quiz && this.quiz !== quiz) {
      this.quiz.cancel();
    }
    this.quizSubscription?.dispose();
    this.quiz = quiz;
    this.uri = uri;
    this.tab = 'quiz';
    this.viewing = undefined;
    this.quizSubscription = quiz.onDidChange(() => this.post());
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

  async openTranscript(id: string): Promise<void> {
    this.viewing = await this.transcripts.get(id);
    this.tab = 'history';
    this.post();
  }

  showTab(tab: ChatState['tab']): void {
    this.tab = tab;
    this.viewing = undefined;
    this.post();
  }

  state(): ChatState {
    const now = Date.now();
    const quiz = this.quiz;
    return {
      tab: this.tab,
      modelLabel: this.providers.label(),
      settings: {
        active: this.providers.settings(),
        providers: PROVIDERS.map(({ keyUrl, ...p }) => ({
          ...p,
          keySaved: !!this.keySaved[p.id],
          ...(keyUrl ? { keyUrl } : {}),
        })),
        presets: OPENAI_PRESETS,
        version: this.settingsVersion,
      },
      quiz: quiz && {
        file: quiz.hunk.filePath,
        line: changedLineRange(quiz.hunk).start,
        messages: quiz.messages.map(messageHtml),
        canAnswer: quiz.canAnswer,
        busy: quiz.busy,
        done: quiz.done,
      },
      history: this.history.map((t) => historyItem(t, now, quiz?.id)),
      viewing: this.viewing && {
        where: `${this.viewing.filePath}:${this.viewing.line}`,
        meta: transcriptMeta(this.viewing, now),
        messages: this.viewing.messages.map(messageHtml),
      },
    };
  }

  dispose(): void {
    this.quizSubscription?.dispose();
    this.transcriptSubscription.dispose();
    this.providerSubscription.dispose();
    this.quiz?.cancel();
  }

  private async reloadSettings(): Promise<void> {
    const entries = await Promise.all(
      PROVIDERS.map(async (p) => [p.id, p.usesKey && (await this.providers.hasKey(p.id))] as const),
    );
    this.keySaved = Object.fromEntries(entries);
    this.settingsVersion++;
    this.post();
  }

  private reply(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private async reloadHistory(): Promise<void> {
    this.history = await this.transcripts.list();
    this.post();
  }

  private post(): void {
    void this.view?.webview.postMessage({ type: 'state', state: this.state() });
  }

  private async handle(message: ChatMessage): Promise<void> {
    switch (message.action) {
      case 'ready':
        // Open on History when there is no live quiz but there are past ones.
        if (!this.quiz && this.history.length > 0) {
          this.tab = 'history';
        }
        this.post();
        break;
      case 'tab':
        if (message.tab === 'quiz' || message.tab === 'history') {
          this.showTab(message.tab);
        }
        break;
      case 'openTranscript':
        if (typeof message.id === 'string') {
          await this.openTranscript(message.id);
        }
        break;
      case 'closeTranscript':
        this.showTab('history');
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
      case 'loadModels': {
        const form = parseForm(message.form);
        if (form) {
          const result = await this.loadModels(form);
          this.reply({ type: 'models', provider: form.provider, ...result });
        }
        break;
      }
      case 'test': {
        const form = parseForm(message.form);
        if (form) {
          this.reply({ type: 'testResult', ...(await this.testSettings(form)) });
        }
        break;
      }
      case 'saveSettings': {
        const form = parseForm(message.form);
        if (form) {
          this.reply({ type: 'saved', ...(await this.saveSettings(form)) });
        }
        break;
      }
      case 'removeKey':
        if (isProviderId(message.provider)) {
          await this.providers.deleteKey(message.provider);
        }
        break;
      case 'openKeyUrl': {
        // Only the provider's own page, never a URL supplied by the page.
        const url = isProviderId(message.provider)
          ? providerInfo(message.provider).keyUrl
          : undefined;
        if (url) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        }
        break;
      }
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

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDERS.some((p) => p.id === value);
}

/** Validates a form posted by the page; anything malformed is ignored. */
function parseForm(value: unknown): SettingsForm | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const v = value as Record<string, unknown>;
  if (!isProviderId(v.provider)) {
    return undefined;
  }
  const text = (field: unknown) => (typeof field === 'string' ? field.trim() : '');
  const key = text(v.key);
  return {
    provider: v.provider,
    model: text(v.model),
    baseUrl: text(v.baseUrl),
    ...(key ? { key } : {}),
  };
}

function invalidForm(form: SettingsForm): string | undefined {
  return providerInfo(form.provider).usesBaseUrl && form.baseUrl
    ? validateUrl(form.baseUrl)
    : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
