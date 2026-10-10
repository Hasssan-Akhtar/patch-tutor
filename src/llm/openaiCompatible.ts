import { joinUrl, requestJson } from './http';
import {
  ProviderError,
  type CompletionRequest,
  type LLMProvider,
  type ModelInfo,
  type ProviderConfig,
} from './provider';

export interface BaseUrlPreset {
  label: string;
  url: string;
  /** Local servers usually need no key. */
  needsKey: boolean;
}

export const OPENAI_PRESETS: readonly BaseUrlPreset[] = [
  { label: 'OpenAI', url: 'https://api.openai.com/v1', needsKey: true },
  { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', needsKey: true },
  { label: 'Groq', url: 'https://api.groq.com/openai/v1', needsKey: true },
  { label: 'LM Studio (local)', url: 'http://localhost:1234/v1', needsKey: false },
];

// Reasoning models spend part of the budget thinking; leave room for the answer.
const MIN_MAX_TOKENS = 8_000;

interface ChatResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
}

interface ModelsResponse {
  data?: { id: string }[];
}

/** Any server speaking the OpenAI chat completions API. */
export class OpenAiCompatibleProvider implements LLMProvider {
  readonly id = 'openaiCompatible';

  constructor(private readonly config: ProviderConfig) {}

  get name(): string {
    return presetFor(this.config.baseUrl)?.label ?? 'OpenAI-compatible server';
  }

  async complete(request: CompletionRequest): Promise<string> {
    const baseUrl = this.requireBaseUrl();
    if (!this.config.model) {
      throw new ProviderError(
        `Choose a model for ${this.name} in Patch Tutor model settings.`,
        'notFound',
      );
    }
    // OpenAI's own API renamed the field for newer models; other servers keep max_tokens.
    const maxField =
      new URL(baseUrl).hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens';

    const response = (await requestJson(joinUrl(baseUrl, '/chat/completions'), {
      providerName: this.name,
      signal: request.signal,
      headers: await this.authHeaders(),
      body: {
        model: this.config.model,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
        [maxField]: Math.max(request.maxTokens, MIN_MAX_TOKENS),
      },
    })) as ChatResponse;

    const choice = response.choices?.[0];
    if (choice?.finish_reason === 'content_filter') {
      throw new ProviderError(`${this.name} declined to answer this request.`, 'refused');
    }
    return choice?.message?.content ?? '';
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const response = (await requestJson(joinUrl(this.requireBaseUrl(), '/models'), {
      providerName: this.name,
      signal,
      headers: await this.authHeaders(),
    })) as ModelsResponse;
    return (response.data ?? [])
      .map((m) => ({ id: m.id, label: m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private requireBaseUrl(): string {
    if (!this.config.baseUrl) {
      throw new ProviderError(
        'Set the server URL for the OpenAI-compatible provider in Patch Tutor model settings.',
        'notFound',
      );
    }
    return this.config.baseUrl;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const key = await this.config.getKey();
    if (!key && (presetFor(this.config.baseUrl)?.needsKey ?? false)) {
      throw new ProviderError(
        `Add your ${this.name} API key in Patch Tutor model settings.`,
        'auth',
      );
    }
    return key ? { authorization: `Bearer ${key}` } : {};
  }
}

export function presetFor(baseUrl: string): BaseUrlPreset | undefined {
  const normalized = baseUrl.replace(/\/+$/, '');
  return OPENAI_PRESETS.find((p) => p.url === normalized);
}
