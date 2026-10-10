import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ProviderError } from '../../src/llm/provider';
import { VscodeLmProvider } from '../../src/llm/vscodeLm';

type SendRequest = (
  messages: unknown[],
  options: unknown,
  token: { isCancellationRequested: boolean },
) => Promise<{ text: AsyncIterable<string> }>;

function fakeModel(id: string, family: string, sendRequest?: SendRequest) {
  return {
    id,
    family,
    name: id,
    sendRequest: vi.fn(sendRequest ?? (async () => ({ text: stream(['O', 'K']) }))),
  };
}

async function* stream(chunks: string[]): AsyncIterable<string> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// Fake models only implement what the adapter uses, so the mock is typed loosely.
const selectChatModels = vscode.lm.selectChatModels as unknown as Mock<
  () => Promise<ReturnType<typeof fakeModel>[]>
>;
const request = { system: 'be brief', user: 'hello', maxTokens: 10 };

async function completeError(provider: VscodeLmProvider, signal?: AbortSignal) {
  const error = await provider.complete({ ...request, signal }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
}

describe('VscodeLmProvider', () => {
  beforeEach(() => {
    selectChatModels.mockReset();
  });

  it('asks only for Copilot models', async () => {
    selectChatModels.mockResolvedValue([fakeModel('gpt-x', 'gpt')]);

    await new VscodeLmProvider('').complete(request);

    expect(selectChatModels).toHaveBeenCalledWith({ vendor: 'copilot' });
  });

  it('sends the system prompt first, then the user prompt, and joins the streamed reply', async () => {
    const model = fakeModel('gpt-x', 'gpt');
    selectChatModels.mockResolvedValue([model]);

    const reply = await new VscodeLmProvider('').complete(request);

    expect(reply).toBe('OK');
    const [messages, options] = model.sendRequest.mock.calls[0] ?? [];
    expect(messages).toEqual([
      vscode.LanguageModelChatMessage.User('be brief'),
      vscode.LanguageModelChatMessage.User('hello'),
    ]);
    expect(options).toMatchObject({ justification: expect.any(String) });
  });

  it('uses the first model when no model is configured', async () => {
    const first = fakeModel('a', 'fam-a');
    const second = fakeModel('b', 'fam-b');
    selectChatModels.mockResolvedValue([first, second]);

    await new VscodeLmProvider('').complete(request);

    expect(first.sendRequest).toHaveBeenCalled();
    expect(second.sendRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['id', 'b'],
    ['family', 'fam-b'],
  ])('picks the configured model by %s', async (_by, setting) => {
    const first = fakeModel('a', 'fam-a');
    const second = fakeModel('b', 'fam-b');
    selectChatModels.mockResolvedValue([first, second]);

    await new VscodeLmProvider(setting).complete(request);

    expect(second.sendRequest).toHaveBeenCalled();
    expect(first.sendRequest).not.toHaveBeenCalled();
  });

  it('reports notFound when Copilot has no models', async () => {
    selectChatModels.mockResolvedValue([]);

    const error = await completeError(new VscodeLmProvider(''));

    expect(error.kind).toBe('notFound');
    expect(error.message).toMatch(/Copilot/);
  });

  it('lists available families when the configured model is missing', async () => {
    selectChatModels.mockResolvedValue([fakeModel('a', 'fam-a'), fakeModel('b', 'fam-b')]);

    const error = await completeError(new VscodeLmProvider('nope'));

    expect(error.kind).toBe('notFound');
    expect(error.message).toContain('fam-a, fam-b');
  });

  it.each([
    [vscode.LanguageModelError.NoPermissions(), 'auth'],
    [vscode.LanguageModelError.Blocked(), 'rateLimit'],
    [vscode.LanguageModelError.NotFound(), 'notFound'],
    [new Error('boom'), 'unknown'],
  ])('maps %o to %s', async (thrown, kind) => {
    selectChatModels.mockResolvedValue([
      fakeModel('a', 'fam', async () => {
        throw thrown;
      }),
    ]);

    const error = await completeError(new VscodeLmProvider(''));

    expect(error.kind).toBe(kind);
    expect(error.cause).toBe(thrown);
  });

  it('does not send anything when already aborted', async () => {
    const model = fakeModel('a', 'fam');
    selectChatModels.mockResolvedValue([model]);

    const error = await completeError(new VscodeLmProvider(''), AbortSignal.abort());

    expect(error.kind).toBe('cancelled');
    expect(model.sendRequest).not.toHaveBeenCalled();
  });

  it('cancels the VS Code token when the signal aborts mid-request', async () => {
    const controller = new AbortController();
    let token: { isCancellationRequested: boolean } | undefined;
    selectChatModels.mockResolvedValue([
      fakeModel('a', 'fam', async (_messages, _options, t) => {
        token = t;
        controller.abort();
        return { text: stream(['partial']) };
      }),
    ]);

    const error = await completeError(new VscodeLmProvider(''), controller.signal);

    expect(token?.isCancellationRequested).toBe(true);
    expect(error.kind).toBe('cancelled');
  });
});
