import * as vscode from 'vscode';
import { OPENAI_PRESETS } from '../llm/openaiCompatible';
import { ProviderError, type ProviderId } from '../llm/provider';
import {
  PROVIDERS,
  providerInfo,
  type ProviderService,
  type ProviderSettings,
} from '../services/providerService';

/** Command Palette versions of the model settings, for keyboard users. */
export function registerProviderCommands(
  context: vscode.ExtensionContext,
  providers: ProviderService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('patchTutor.chooseProvider', () => chooseProvider(providers)),
    vscode.commands.registerCommand('patchTutor.chooseModel', () =>
      chooseModel(providers, providers.settings()),
    ),
    vscode.commands.registerCommand('patchTutor.setApiKey', () =>
      promptForKey(providers, providers.settings().provider),
    ),
    vscode.commands.registerCommand('patchTutor.testConnection', () =>
      runTestConnection(providers),
    ),
  );
}

async function chooseProvider(providers: ProviderService): Promise<void> {
  const current = providers.settings().provider;
  const picked = await vscode.window.showQuickPick(
    PROVIDERS.map((p) => ({ ...p, description: p.id === current ? 'current' : undefined })),
    { title: 'Patch Tutor: Choose provider' },
  );
  if (!picked) {
    return;
  }
  let settings: ProviderSettings = { provider: picked.id, model: '', baseUrl: '' };
  if (picked.id === 'openaiCompatible') {
    const baseUrl = await chooseOpenAiBaseUrl();
    if (baseUrl === undefined) {
      return;
    }
    settings = { ...settings, baseUrl };
  } else if (picked.id === 'ollama') {
    const baseUrl = await vscode.window.showInputBox({
      title: 'Ollama server URL',
      value: picked.defaultBaseUrl,
      validateInput: validateUrl,
    });
    if (baseUrl === undefined) {
      return;
    }
    settings = { ...settings, baseUrl };
  }
  if (picked.usesKey && !(await providers.hasKey(picked.id))) {
    const optional =
      picked.id === 'openaiCompatible' && settings.baseUrl.startsWith('http://localhost');
    if (!optional && !(await promptForKey(providers, picked.id))) {
      return;
    }
  }
  await providers.save(settings);
  await chooseModel(providers, settings);
}

async function chooseOpenAiBaseUrl(): Promise<string | undefined> {
  const custom = { label: 'Custom URL…', url: '' };
  const picked = await vscode.window.showQuickPick(
    [...OPENAI_PRESETS.map((p) => ({ label: p.label, detail: p.url, url: p.url })), custom],
    { title: 'Which OpenAI-compatible server?' },
  );
  if (!picked) {
    return undefined;
  }
  if (picked !== custom) {
    return picked.url;
  }
  return vscode.window.showInputBox({
    title: 'Server base URL',
    placeHolder: 'https://example.com/v1',
    validateInput: validateUrl,
  });
}

async function chooseModel(providers: ProviderService, settings: ProviderSettings): Promise<void> {
  let models: { id: string; label: string; detail?: string }[] = [];
  try {
    models = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Patch Tutor: Loading models…' },
      () => providers.listModels(settings),
    );
  } catch (error) {
    void vscode.window.showWarningMessage(`Patch Tutor: ${messageOf(error)}`);
  }
  const typeIt = { id: '__custom__', label: 'Type a model name…' };
  const defaultItem = { id: '', label: 'Default', detail: 'Let Patch Tutor pick.' };
  const picked = await vscode.window.showQuickPick(
    [defaultItem, ...models, typeIt].map((m) => ({
      ...m,
      description: m.id && m.id === settings.model ? 'current' : undefined,
    })),
    { title: 'Patch Tutor: Choose model', matchOnDetail: true },
  );
  if (!picked) {
    return;
  }
  const model =
    picked.id === typeIt.id
      ? await vscode.window.showInputBox({ title: 'Model name', value: settings.model })
      : picked.id;
  if (model !== undefined) {
    await providers.save({ ...settings, model });
  }
}

/** Asks for a key and stores it in secret storage; returns false if cancelled. */
async function promptForKey(providers: ProviderService, provider: ProviderId): Promise<boolean> {
  const info = providerInfo(provider);
  if (!info.usesKey) {
    void vscode.window.showInformationMessage(
      `Patch Tutor: ${info.label} doesn't need an API key.`,
    );
    return true;
  }
  const key = await vscode.window.showInputBox({
    title: `${info.label} API key`,
    prompt: 'Stored in your OS keychain through VS Code. Never written to settings.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Paste your API key'),
  });
  if (!key) {
    return false;
  }
  await providers.setKey(provider, key);
  return true;
}

async function runTestConnection(providers: ProviderService): Promise<void> {
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Patch Tutor: Testing connection…',
        cancellable: true,
      },
      (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        return providers.testConnection(undefined, undefined, controller.signal);
      },
    );
    void vscode.window.showInformationMessage(
      `Patch Tutor: Connected to ${result.providerName} (${result.model}) in ${result.elapsedMs} ms.`,
    );
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'cancelled') {
      return;
    }
    const action = await vscode.window.showErrorMessage(
      `Patch Tutor: ${messageOf(error)}`,
      'Open model settings',
    );
    if (action) {
      await vscode.commands.executeCommand('patchTutor.openModelSettings');
    }
  }
}

export function validateUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? undefined
      : 'Use an http:// or https:// URL';
  } catch {
    return 'Enter a full URL, e.g. https://example.com/v1';
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
