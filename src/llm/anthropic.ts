import { joinUrl, requestJson } from './http';
import {
  ProviderError,
  type CompletionRequest,
  type LLMProvider,
  type ModelInfo,
  type ProviderConfig,
} from './provider';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
const API_VERSION = '2023-06-01';

// Current models always think, and thinking counts against max_tokens, so a
// small budget would cut replies off. The prompts keep the answers short.
const MIN_MAX_TOKENS = 16_000;

// Models that accept server-side refusal fallbacks ("default" routes by category).
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  stop_reason?: string;
}

interface ModelsPage {
  data?: { id: string; display_name?: string }[];
  has_more?: boolean;
  last_id?: string;
}

/** Claude through the Anthropic Messages API, over plain fetch. */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';

  constructor(private readonly config: ProviderConfig) {}

  async complete(request: CompletionRequest): Promise<string> {
    const key = await requireKey(this.config);
    const model = this.config.model || ANTHROPIC_DEFAULT_MODEL;
    const fallbacks = FALLBACK_MODELS.has(model);

    const response = (await requestJson(joinUrl(this.baseUrl(), '/v1/messages'), {
      providerName: this.name,
      signal: request.signal,
      headers: {
        ...headers(key),
        ...(fallbacks ? { 'anthropic-beta': FALLBACK_BETA } : {}),
      },
      body: {
        model,
        max_tokens: Math.max(request.maxTokens, MIN_MAX_TOKENS),
        system: request.system,
        messages: [{ role: 'user', content: request.user }],
        ...(fallbacks ? { fallbacks: 'default' } : {}),
      },
    })) as MessagesResponse;

    // Check the stop reason before reading content: a refusal may have no text at all.
    if (response.stop_reason === 'refusal') {
      throw new ProviderError(
        'Claude declined to answer this request. Try again, or pick another model.',
        'refused',
      );
    }
    return (response.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const key = await requireKey(this.config);
    const models: ModelInfo[] = [];
    let after: string | undefined;
    do {
      const query = new URLSearchParams({ limit: '1000', ...(after ? { after_id: after } : {}) });
      const page = (await requestJson(joinUrl(this.baseUrl(), `/v1/models?${query}`), {
        providerName: this.name,
        signal,
        headers: headers(key),
      })) as ModelsPage;
      for (const model of page.data ?? []) {
        models.push({ id: model.id, label: model.display_name ?? model.id });
      }
      after = page.has_more ? page.last_id : undefined;
    } while (after);
    return models;
  }

  private baseUrl(): string {
    return this.config.baseUrl || ANTHROPIC_BASE_URL;
  }
}

function headers(key: string): Record<string, string> {
  return { 'x-api-key': key, 'anthropic-version': API_VERSION };
}

async function requireKey(config: ProviderConfig): Promise<string> {
  const key = await config.getKey();
  if (!key) {
    throw new ProviderError('Add your Anthropic API key in Patch Tutor model settings.', 'auth');
  }
  return key;
}
