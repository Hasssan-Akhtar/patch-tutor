import { joinUrl, requestJson } from './http';
import {
  ProviderError,
  type CompletionRequest,
  type LLMProvider,
  type ModelInfo,
  type ProviderConfig,
} from './provider';

export const OLLAMA_DEFAULT_URL = 'http://localhost:11434';
const MIN_PREDICT = 2_048;

interface ChatResponse {
  message?: { content?: string };
}

interface TagsResponse {
  models?: { name: string; details?: { parameter_size?: string } }[];
}

/** A local model served by Ollama: nothing leaves the machine, no key needed. */
export class OllamaProvider implements LLMProvider {
  readonly id = 'ollama';
  readonly name = 'Ollama';

  constructor(private readonly config: ProviderConfig) {}

  async complete(request: CompletionRequest): Promise<string> {
    if (!this.config.model) {
      throw new ProviderError('Choose an Ollama model in Patch Tutor model settings.', 'notFound');
    }
    try {
      const response = (await requestJson(joinUrl(this.baseUrl(), '/api/chat'), {
        providerName: this.name,
        signal: request.signal,
        body: {
          model: this.config.model,
          stream: false,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          options: { num_predict: Math.max(request.maxTokens, MIN_PREDICT) },
          // Ollama can constrain output to valid JSON, which small models need.
          ...(request.json ? { format: 'json' } : {}),
        },
      })) as ChatResponse;
      return response.message?.content ?? '';
    } catch (error) {
      throw this.explain(error);
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    try {
      const response = (await requestJson(joinUrl(this.baseUrl(), '/api/tags'), {
        providerName: this.name,
        signal,
      })) as TagsResponse;
      return (response.models ?? []).map((m) => ({
        id: m.name,
        label: m.name,
        detail: m.details?.parameter_size,
      }));
    } catch (error) {
      throw this.explain(error);
    }
  }

  private baseUrl(): string {
    return this.config.baseUrl || OLLAMA_DEFAULT_URL;
  }

  /** Turns the two common local problems into instructions. */
  private explain(error: unknown): unknown {
    if (!(error instanceof ProviderError)) {
      return error;
    }
    if (error.kind === 'network') {
      return new ProviderError(
        `Ollama isn't running at ${this.baseUrl()}. Start it (open the Ollama app or run \`ollama serve\`), then try again.`,
        'network',
        { cause: error },
      );
    }
    if (error.kind === 'notFound') {
      return new ProviderError(
        `Model "${this.config.model}" isn't downloaded. Run \`ollama pull ${this.config.model}\`, then try again.`,
        'notFound',
        { cause: error },
      );
    }
    return error;
  }
}
