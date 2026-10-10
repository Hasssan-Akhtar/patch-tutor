import * as vscode from 'vscode';
import { ProviderError } from '../llm/provider';
import {
  getModel,
  getProviderId,
  listModels,
  PROVIDERS,
  setModel,
  setProvider,
  testConnection,
} from '../services/providerService';

export function registerProviderCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('patchTutor.chooseProvider', chooseProvider),
    vscode.commands.registerCommand('patchTutor.chooseModel', chooseModel),
    vscode.commands.registerCommand('patchTutor.testConnection', runTestConnection),
  );
}

async function chooseProvider(): Promise<void> {
  const current = getProviderId();
  const picked = await vscode.window.showQuickPick(
    PROVIDERS.map((p) => ({
      ...p,
      description: p.id === current ? 'current' : undefined,
    })),
    { title: 'Patch Tutor: Choose provider' },
  );
  if (!picked) {
    return;
  }
  await setProvider(picked.id);
  await chooseModel();
}

async function chooseModel(): Promise<void> {
  const models = await listModels(getProviderId());
  if (models.length === 0) {
    void vscode.window.showWarningMessage(
      'Patch Tutor: No Copilot models found. Install GitHub Copilot and sign in first.',
    );
    return;
  }
  const current = getModel();
  const defaultItem = { id: '', label: 'Default', detail: 'Let the provider pick a model.' };
  const picked = await vscode.window.showQuickPick(
    [defaultItem, ...models].map((m) => ({
      ...m,
      description: m.id === current ? 'current' : undefined,
    })),
    { title: 'Patch Tutor: Choose model', matchOnDetail: true },
  );
  if (picked) {
    await setModel(picked.id);
  }
}

async function runTestConnection(): Promise<void> {
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
        return testConnection(controller.signal);
      },
    );
    void vscode.window.showInformationMessage(
      `Patch Tutor: Connected to ${result.providerName} in ${result.elapsedMs} ms. Reply: "${result.reply}"`,
    );
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'cancelled') {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const action = await vscode.window.showErrorMessage(
      `Patch Tutor: ${message}`,
      'Choose provider',
    );
    if (action) {
      await chooseProvider();
    }
  }
}
