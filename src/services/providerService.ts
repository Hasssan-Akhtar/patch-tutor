import * as vscode from 'vscode';
import { ANTHROPIC_DEFAULT_MODEL, AnthropicProvider } from '../llm/anthropic';
import { OLLAMA_DEFAULT_URL, OllamaProvider } from '../llm/ollama';
import { OPENAI_PRESETS, OpenAiCompatibleProvider } from '../llm/openaiCompatible';
import type { LLMProvider, ModelInfo, ProviderConfig, ProviderId } from '../llm/provider';
import { listVscodeModels, VscodeLmProvider } from '../llm/vscodeLm';
import connectionTestPrompt from '../prompts/connection-test.md';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  detail: string;
  /** Whether this provider can use an API key (it may still be optional, e.g. LM Studio). */
  usesKey: boolean;
  usesBaseUrl: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Where to get a key, opened only when the user clicks the link. */
  keyUrl?: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'vscodeLm',
    label: 'VS Code models',
    detail: 'GitHub Copilot or any model another extension adds to VS Code. No API key needed.',
    usesKey: false,
    usesBaseUrl: false,
    defaultBaseUrl: '',
    defaultModel: '',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    detail: 'Claude models with your Anthropic API key.',
    usesKey: true,
    usesBaseUrl: false,
    defaultBaseUrl: '',
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    keyUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openaiCompatible',
    label: 'OpenAI-compatible',
    detail: 'OpenAI, OpenRouter, Groq, LM Studio or any server with the same API.',
    usesKey: true,
    usesBaseUrl: true,
    defaultBaseUrl: OPENAI_PRESETS[0]?.url ?? '',
    defaultModel: '',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    detail: 'A model running on this machine. Nothing leaves your computer.',
    usesKey: false,
    usesBaseUrl: true,
    defaultBaseUrl: OLLAMA_DEFAULT_URL,
    defaultModel: '',
  },
];

export interface ProviderSettings {
  provider: ProviderId;
  model: string;
  baseUrl: string;
}

export interface ConnectionResult {
  providerName: string;
  model: string;
  reply: string;
  elapsedMs: number;
}

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? (PROVIDERS[0] as ProviderInfo);
}

const KEY_PREFIX = 'patchTutor.apiKey.';

/**
 * Chooses and configures the language model. Provider, model and base URL
 * live in settings; API keys live only in VS Code's secret storage (the OS
 * keychain) and are never written to settings or shown again.
 */
export class ProviderService {
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires when the provider, model, URL or a key changes. */
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('patchTutor')) {
          this.changed.fire();
        }
      }),
      secrets.onDidChange((e) => {
        if (e.key.startsWith(KEY_PREFIX)) {
          this.changed.fire();
        }
      }),
    );
  }

  settings(): ProviderSettings {
    const config = vscode.workspace.getConfiguration('patchTutor');
    const provider = config.get<ProviderId>('provider', 'vscodeLm');
    return {
      provider: PROVIDERS.some((p) => p.id === provider) ? provider : 'vscodeLm',
      model: config.get<string>('model', ''),
      baseUrl: config.get<string>('baseUrl', ''),
    };
  }

  /** Identifies the configured provider and model, for cache keys. */
  modelKey(): string {
    const { provider, model } = this.settings();
    return `${provider}:${model || 'default'}`;
  }

  /** A short label such as "Anthropic · claude-opus-5-5". */
  label(): string {
    const { provider, model } = this.settings();
    const info = providerInfo(provider);
    const shown = model || info.defaultModel;
    return shown ? `${info.label} · ${shown}` : info.label;
  }

  async save(settings: ProviderSettings): Promise<void> {
    const config = vscode.workspace.getConfiguration('patchTutor');
    const target = vscode.ConfigurationTarget.Global;
    await config.update('provider', settings.provider, target);
    await config.update('model', settings.model || undefined, target);
    await config.update('baseUrl', settings.baseUrl || undefined, target);
  }

  async setKey(provider: ProviderId, key: string): Promise<void> {
    await this.secrets.store(KEY_PREFIX + provider, key.trim());
  }

  async deleteKey(provider: ProviderId): Promise<void> {
    await this.secrets.delete(KEY_PREFIX + provider);
  }

  async hasKey(provider: ProviderId): Promise<boolean> {
    return !!(await this.secrets.get(KEY_PREFIX + provider));
  }

  /**
   * A provider for the saved settings, or for candidate settings being tried
   * in the settings screen (with a key typed there but not yet saved).
   */
  create(
    settings: ProviderSettings = this.settings(),
    keyOverride?: string,
  ): LLMProvider & {
    listModels?: (signal?: AbortSignal) => Promise<ModelInfo[]>;
  } {
    const info = providerInfo(settings.provider);
    const config: ProviderConfig = {
      model: settings.model || info.defaultModel,
      baseUrl: settings.baseUrl || info.defaultBaseUrl,
      getKey: async () =>
        keyOverride?.trim() || (await this.secrets.get(KEY_PREFIX + settings.provider)),
    };
    switch (settings.provider) {
      case 'anthropic':
        return new AnthropicProvider(config);
      case 'openaiCompatible':
        return new OpenAiCompatibleProvider(config);
      case 'ollama':
        return new OllamaProvider(config);
      case 'vscodeLm':
        return new VscodeLmProvider(settings.model);
    }
  }

  async listModels(
    settings: ProviderSettings = this.settings(),
    keyOverride?: string,
    signal?: AbortSignal,
  ): Promise<ModelInfo[]> {
    if (settings.provider === 'vscodeLm') {
      return (await listVscodeModels()).map((m) => ({
        id: m.id,
        label: m.name,
        detail: `${m.vendor} · ${m.family} · ${m.maxInputTokens.toLocaleString()} input tokens`,
      }));
    }
    const provider = this.create(settings, keyOverride);
    return provider.listModels ? provider.listModels(signal) : [];
  }

  /** Sends a tiny request and reports how it went. */
  async testConnection(
    settings: ProviderSettings = this.settings(),
    keyOverride?: string,
    signal?: AbortSignal,
  ): Promise<ConnectionResult> {
    const provider = this.create(settings, keyOverride);
    const started = Date.now();
    const reply = await provider.complete({
      system: connectionTestPrompt,
      user: 'Are you there?',
      maxTokens: 16,
      signal,
    });
    return {
      providerName: provider.name,
      model: settings.model || providerInfo(settings.provider).defaultModel || 'default',
      reply: reply.trim(),
      elapsedMs: Date.now() - started,
    };
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
