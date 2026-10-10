import { ProviderError } from './provider';

/** Long enough for a slow local model writing a quiz; short enough to not hang forever. */
export const REQUEST_TIMEOUT_MS = 120_000;

export interface JsonRequest {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  /** Shown in error messages, e.g. "Anthropic". */
  providerName: string;
  timeoutMs?: number;
}

/**
 * fetch + JSON with the errors every adapter needs: cancellation, a timeout,
 * unreachable servers, and HTTP status codes mapped to ProviderError kinds.
 */
export async function requestJson(url: string, request: JsonRequest): Promise<unknown> {
  const timeout = AbortSignal.timeout(request.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method: request.method ?? (request.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(request.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...request.headers,
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted) {
      throw new ProviderError('Request was cancelled.', 'cancelled', { cause: error });
    }
    if (timeout.aborted) {
      throw new ProviderError(
        `${request.providerName} did not answer within ${Math.round((request.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000)} seconds.`,
        'network',
        { cause: error },
      );
    }
    throw new ProviderError(
      `Couldn't reach ${request.providerName} at ${new URL(url).origin}: ${describeNetworkError(error)}`,
      'network',
      { cause: error },
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw httpError(response.status, text, request.providerName);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ProviderError(
      `${request.providerName} returned a reply that is not JSON.`,
      'unknown',
      {
        cause: error,
      },
    );
  }
}

export function httpError(status: number, body: string, providerName: string): ProviderError {
  const detail = errorMessageFrom(body);
  const suffix = detail ? ` (${detail})` : '';
  switch (true) {
    case status === 401 || status === 403:
      return new ProviderError(
        `${providerName} rejected the API key${suffix}. Check it in Patch Tutor's model settings.`,
        'auth',
      );
    case status === 429:
      return new ProviderError(
        `${providerName} rate limit reached${suffix}. Wait a moment and try again.`,
        'rateLimit',
      );
    case status === 529 || status === 503:
      return new ProviderError(
        `${providerName} is overloaded right now${suffix}. Try again shortly.`,
        'rateLimit',
      );
    case status === 404:
      return new ProviderError(
        `${providerName} could not find that model or URL${suffix}.`,
        'notFound',
      );
    default:
      return new ProviderError(`${providerName} returned HTTP ${status}${suffix}.`, 'unknown');
  }
}

/** Pulls a readable message out of the error bodies the supported APIs return. */
function errorMessageFrom(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    const error = parsed.error;
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message: unknown }).message);
    }
    if (typeof parsed.message === 'string') {
      return parsed.message;
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  const trimmed = body.trim();
  return trimmed ? trimmed.slice(0, 200) : undefined;
}

function describeNetworkError(error: unknown): string {
  const cause = (error as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === 'ECONNREFUSED') {
    return 'connection refused (is the server running?)';
  }
  if (cause?.code === 'ENOTFOUND') {
    return 'host not found (check the URL and your connection)';
  }
  return cause?.message ?? (error instanceof Error ? error.message : String(error));
}

/** Joins a base URL and a path without doubling or dropping slashes. */
export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
