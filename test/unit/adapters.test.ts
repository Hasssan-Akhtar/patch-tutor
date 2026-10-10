import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from '../../src/llm/anthropic';
import { httpError, joinUrl, requestJson } from '../../src/llm/http';
import { OllamaProvider } from '../../src/llm/ollama';
import { OpenAiCompatibleProvider, presetFor } from '../../src/llm/openaiCompatible';
import { ProviderError, type ProviderConfig } from '../../src/llm/provider';

const fetchMock = vi.fn<typeof fetch>();

function reply(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function sent(call = 0): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[call] ?? [];
  const requestInit = init ?? {};
  return {
    url: String(url),
    init: requestInit,
    body: requestInit.body ? (JSON.parse(String(requestInit.body)) as Record<string, unknown>) : {},
  };
}

function headersOf(call = 0): Record<string, string> {
  return sent(call).init.headers as Record<string, string>;
}

const config = (over: Partial<ProviderConfig> = {}): ProviderConfig => ({
  model: '',
  baseUrl: '',
  getKey: async () => 'test-key',
  ...over,
});

const request = { system: 'SYSTEM', user: 'USER', maxTokens: 100 };

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AnthropicProvider', () => {
  it('posts a Messages request with the key, version, system prompt and a safe max_tokens', async () => {
    fetchMock.mockResolvedValue(
      reply({
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Hi' },
        ],
        stop_reason: 'end_turn',
      }),
    );

    const text = await new AnthropicProvider(config({ model: 'claude-haiku-5-5' })).complete(
      request,
    );

    expect(text).toBe('Hi');
    const { url, init, body } = sent();
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(headersOf()).toMatchObject({
      'x-api-key': 'test-key',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });
    expect(body).toEqual({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      system: 'SYSTEM',
      messages: [{ role: 'user', content: 'USER' }],
    });
    // Haiku has no server-side fallback, so none is requested.
    expect(headersOf()['anthropic-beta']).toBeUndefined();
  });

  it('defaults to Claude Opus 5.5 and opts into server-side refusal fallbacks', async () => {
    fetchMock.mockResolvedValue(
      reply({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }),
    );

    await new AnthropicProvider(config()).complete(request);

    expect(sent().body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
    expect(headersOf()['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
  });

  it('reports a refusal instead of returning empty text', async () => {
    fetchMock.mockResolvedValue(reply({ content: [], stop_reason: 'refusal' }));

    const error = await failure(new AnthropicProvider(config()).complete(request));

    expect(error.kind).toBe('refused');
  });

  it('asks for a key before calling the API', async () => {
    const error = await failure(
      new AnthropicProvider(config({ getKey: async () => undefined })).complete(request),
    );

    expect(error.kind).toBe('auth');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rateLimit'],
    [529, 'rateLimit'],
    [404, 'notFound'],
    [500, 'unknown'],
  ])('maps HTTP %i to %s, including the API message', async (status, kind) => {
    fetchMock.mockResolvedValue(
      reply({ type: 'error', error: { type: 'x', message: 'detail from API' } }, status),
    );

    const error = await failure(new AnthropicProvider(config()).complete(request));

    expect(error.kind).toBe(kind);
    expect(error.message).toContain('detail from API');
  });

  it('lists models across pages', async () => {
    fetchMock
      .mockResolvedValueOnce(
        reply({
          data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }],
          has_more: true,
          last_id: 'claude-opus-5-5',
        }),
      )
      .mockResolvedValueOnce(
        reply({
          data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }],
          has_more: false,
        }),
      );

    const models = await new AnthropicProvider(config()).listModels();

    expect(models).toEqual([
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
    ]);
    expect(sent(0).url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(sent(1).url).toBe(
      'https://api.anthropic.com/v1/models?limit=1000&after_id=claude-opus-5-5',
    );
  });
});

describe('OpenAiCompatibleProvider', () => {
  it('posts chat completions with a bearer key and system + user messages', async () => {
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: 'Hello' } }] }));
    const provider = new OpenAiCompatibleProvider(
      config({ baseUrl: 'https://openrouter.ai/api/v1/', model: 'meta/llama' }),
    );

    expect(await provider.complete(request)).toBe('Hello');
    expect(provider.name).toBe('OpenRouter');
    const { url, body } = sent();
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(headersOf().authorization).toBe('Bearer test-key');
    expect(body).toEqual({
      model: 'meta/llama',
      messages: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: 'USER' },
      ],
      max_tokens: 8000,
    });
  });

  it("uses OpenAI's max_completion_tokens on api.openai.com", async () => {
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: 'x' } }] }));

    await new OpenAiCompatibleProvider(
      config({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-x' }),
    ).complete(request);

    expect(sent().body).toHaveProperty('max_completion_tokens', 8000);
    expect(sent().body).not.toHaveProperty('max_tokens');
  });

  it('works without a key for local servers, but requires one for hosted presets', async () => {
    fetchMock.mockResolvedValue(reply({ choices: [{ message: { content: 'local' } }] }));
    const noKey = { getKey: async () => undefined };

    await new OpenAiCompatibleProvider(
      config({ ...noKey, baseUrl: 'http://localhost:1234/v1', model: 'qwen' }),
    ).complete(request);
    expect(headersOf().authorization).toBeUndefined();

    const error = await failure(
      new OpenAiCompatibleProvider(
        config({ ...noKey, baseUrl: 'https://api.groq.com/openai/v1', model: 'llama' }),
      ).complete(request),
    );
    expect(error.kind).toBe('auth');
  });

  it('needs a model and a base URL', async () => {
    expect(
      (
        await failure(
          new OpenAiCompatibleProvider(config({ baseUrl: 'http://x/v1' })).complete(request),
        )
      ).kind,
    ).toBe('notFound');
    expect(
      (await failure(new OpenAiCompatibleProvider(config({ model: 'm' })).complete(request))).kind,
    ).toBe('notFound');
  });

  it('lists models sorted by id', async () => {
    fetchMock.mockResolvedValue(reply({ data: [{ id: 'b' }, { id: 'a' }] }));

    const models = await new OpenAiCompatibleProvider(
      config({ baseUrl: 'http://x/v1' }),
    ).listModels();

    expect(models.map((m) => m.id)).toEqual(['a', 'b']);
    expect(sent().url).toBe('http://x/v1/models');
  });

  it('recognizes presets with or without a trailing slash', () => {
    expect(presetFor('https://api.openai.com/v1/')?.label).toBe('OpenAI');
    expect(presetFor('https://example.com/v1')).toBeUndefined();
  });
});

describe('OllamaProvider', () => {
  it('posts a non-streaming chat to the local server, with JSON mode when asked', async () => {
    fetchMock.mockResolvedValue(reply({ message: { content: '{"a":1}' } }));

    const text = await new OllamaProvider(config({ model: 'llama3.2' })).complete({
      ...request,
      json: true,
    });

    expect(text).toBe('{"a":1}');
    const { url, body } = sent();
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(headersOf().authorization).toBeUndefined();
    expect(body).toEqual({
      model: 'llama3.2',
      stream: false,
      messages: [
        { role: 'system', content: 'SYSTEM' },
        { role: 'user', content: 'USER' },
      ],
      options: { num_predict: 2048 },
      format: 'json',
    });
  });

  it('explains when Ollama is not running', async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    );

    const error = await failure(
      new OllamaProvider(config({ model: 'llama3.2' })).complete(request),
    );

    expect(error.kind).toBe('network');
    expect(error.message).toContain("Ollama isn't running at http://localhost:11434");
  });

  it('explains how to download a missing model', async () => {
    fetchMock.mockResolvedValue(
      reply({ error: 'model "llama9" not found, try pulling it first' }, 404),
    );

    const error = await failure(new OllamaProvider(config({ model: 'llama9' })).complete(request));

    expect(error.kind).toBe('notFound');
    expect(error.message).toContain('ollama pull llama9');
  });

  it('lists local models with their sizes', async () => {
    fetchMock.mockResolvedValue(
      reply({ models: [{ name: 'llama3.2:latest', details: { parameter_size: '3.2B' } }] }),
    );

    expect(await new OllamaProvider(config({ baseUrl: 'http://box:11434' })).listModels()).toEqual([
      { id: 'llama3.2:latest', label: 'llama3.2:latest', detail: '3.2B' },
    ]);
    expect(sent().url).toBe('http://box:11434/api/tags');
  });
});

describe('requestJson', () => {
  it('reports cancellation separately from network failures', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const controller = new AbortController();

    const pending = requestJson('http://x/y', { providerName: 'X', signal: controller.signal });
    controller.abort();

    expect((await failure(pending)).kind).toBe('cancelled');
  });

  it('times out slow servers', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('timeout', 'TimeoutError')),
          );
        }),
    );

    const error = await failure(requestJson('http://x/y', { providerName: 'X', timeoutMs: 20 }));

    expect(error.kind).toBe('network');
    expect(error.message).toMatch(/did not answer/);
  });

  it('rejects replies that are not JSON', async () => {
    fetchMock.mockResolvedValue(reply('<html>proxy error</html>'));

    expect((await failure(requestJson('http://x/y', { providerName: 'X' }))).message).toMatch(
      /not JSON/,
    );
  });

  it('builds readable errors from plain-text bodies too', () => {
    expect(httpError(502, 'Bad gateway', 'X').message).toBe('X returned HTTP 502 (Bad gateway).');
  });

  it('joins URLs without doubled slashes', () => {
    expect(joinUrl('http://x/v1/', '/models')).toBe('http://x/v1/models');
  });
});
