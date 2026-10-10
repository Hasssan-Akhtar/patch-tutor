export type ProviderId = 'vscodeLm' | 'anthropic' | 'openaiCompatible' | 'ollama';

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
  /** The reply must be a JSON object; adapters that can enforce it do. */
  json?: boolean;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly name: string;
  complete(request: CompletionRequest): Promise<string>;
}

export interface ModelInfo {
  id: string;
  label: string;
  detail?: string;
}

/** Where an adapter gets its settings; the key is read lazily from secret storage. */
export interface ProviderConfig {
  model: string;
  baseUrl: string;
  getKey: () => Promise<string | undefined>;
}

export type ProviderErrorKind =
  'auth' | 'rateLimit' | 'network' | 'notFound' | 'refused' | 'cancelled' | 'unknown';

/** Every adapter throws this, so callers never handle provider-specific errors. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }
}
