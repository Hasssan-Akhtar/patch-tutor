import * as vscode from 'vscode';
import connectionTestPrompt from '../prompts/connection-test.md';
import type { LLMProvider, ProviderId } from '../llm/provider';
import { listCopilotModels, VscodeLmProvider } from '../llm/vscodeLm';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  detail: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'vscodeLm',
    label: 'GitHub Copilot',
    detail: 'Uses Copilot models through VS Code. No API key needed.',
  },
];

export interface ModelInfo {
  id: string;
  label: string;
  detail: string;
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('patchTutor');
}

export function getProviderId(): ProviderId {
  return config().get<ProviderId>('provider', 'vscodeLm');
}

export function getModel(): string {
  return config().get<string>('model', '');
}

/** Identifies the configured provider and model, for cache keys. */
export function getModelKey(): string {
  return `${getProviderId()}:${getModel() || 'default'}`;
}

export async function setProvider(id: ProviderId): Promise<void> {
  if (id !== getProviderId()) {
    await config().update('provider', id, vscode.ConfigurationTarget.Global);
    await config().update('model', undefined, vscode.ConfigurationTarget.Global);
  }
}

export async function setModel(model: string): Promise<void> {
  await config().update('model', model || undefined, vscode.ConfigurationTarget.Global);
}

export function createProvider(): LLMProvider {
  switch (getProviderId()) {
    case 'vscodeLm':
      return new VscodeLmProvider(getModel());
  }
}

export async function listModels(id: ProviderId): Promise<ModelInfo[]> {
  switch (id) {
    case 'vscodeLm':
      return (await listCopilotModels()).map((m) => ({
        id: m.id,
        label: m.name,
        detail: `${m.family} · ${m.maxInputTokens.toLocaleString()} input tokens`,
      }));
  }
}

export interface ConnectionResult {
  providerName: string;
  reply: string;
  elapsedMs: number;
}

/** Sends a tiny request to the configured provider and reports how it went. */
export async function testConnection(signal?: AbortSignal): Promise<ConnectionResult> {
  const provider = createProvider();
  const started = Date.now();
  const reply = await provider.complete({
    system: connectionTestPrompt,
    user: 'Are you there?',
    maxTokens: 5,
    signal,
  });
  return { providerName: provider.name, reply: reply.trim(), elapsedMs: Date.now() - started };
}
