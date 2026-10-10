export type ProviderId = 'vscodeLm';

export interface CompletionRequest {
  system: string;
  user: string;
  maxTokens: number;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly name: string;
  complete(request: CompletionRequest): Promise<string>;
}

export type ProviderErrorKind =
  'auth' | 'rateLimit' | 'network' | 'notFound' | 'cancelled' | 'unknown';

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
