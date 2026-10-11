import * as vscode from 'vscode';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ProviderError } from '../../src/llm/provider';
import { listVscodeModels, VscodeLmProvider } from '../../src/llm/vscodeLm';

type SendRequest = (
  messages: unknown[],
  options: unknown,
  token: { isCancellationRequested: boolean },
) => Promise<{ text: AsyncIterable<string> }>;

function fakeModel(id: string, family: string, sendRequest?: SendRequest, vendor = 'copilot') {
  return {
    id,
    family,
    vendor,
    name: id,
    maxInputTokens: 1000,
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

  it('asks for models from every vendor', async () => {
    selectChatModels.mockResolvedValue([fakeModel('gpt-x', 'gpt')]);

    await new VscodeLmProvider('').complete(request);

    expect(selectChatModels).toHaveBeenCalledWith();
  });

  it('prefers a Copilot model when no model is configured', async () => {
    const other = fakeModel('o', 'fam-o', undefined, 'other-ext');
    const copilot = fakeModel('c', 'fam-c');
    selectChatModels.mockResolvedValue([other, copilot]);

    await new VscodeLmProvider('').complete(request);

    expect(copilot.sendRequest).toHaveBeenCalled();
    expect(other.sendRequest).not.toHaveBeenCalled();
  });

  it('uses a model from another extension when it is configured', async () => {
    const copilot = fakeModel('c', 'fam-c');
    const other = fakeModel('o', 'fam-o', undefined, 'other-ext');
    selectChatModels.mockResolvedValue([copilot, other]);

    await new VscodeLmProvider('o').complete(request);

    expect(other.sendRequest).toHaveBeenCalled();
    expect(copilot.sendRequest).not.toHaveBeenCalled();
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

  it('reports notFound when VS Code has no models', async () => {
    selectChatModels.mockResolvedValue([]);

    const error = await completeError(new VscodeLmProvider(''));

    expect(error.kind).toBe('notFound');
    expect(error.message).toMatch(/No language models/);
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

  it('explains a model that only VS Code itself may use, and hides it afterwards', async () => {
    const coreOnly = {
      ...fakeModel('core-only', 'fam-core', async () => {
        throw new Error('Model core-only is only available to VS Code core.');
      }),
      name: 'Core Model',
    };
    selectChatModels.mockResolvedValue([coreOnly, fakeModel('b', 'fam-b')]);

    const error = await completeError(new VscodeLmProvider('core-only'));

    expect(error.kind).toBe('notFound');
    expect(error.message).toBe(
      'Core Model is reserved for VS Code itself. Choose another model in Model settings.',
    );
    expect((await listVscodeModels()).map((m) => m.id)).toEqual(['b']);
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

describe('listVscodeModels', () => {
  const model = (id: string, name: string, maxInputTokens: number, vendor = 'copilot') => ({
    id,
    name,
    vendor,
    family: id,
    maxInputTokens,
  });

  beforeEach(() => {
    selectChatModels.mockReset();
  });

  it('hides models that take no input', async () => {
    selectChatModels.mockResolvedValue([
      model('auto', 'Auto', 0, 'copilotcli'),
      model('gpt-5-mini', 'GPT-5 mini', 127_790),
    ] as never);

    expect((await listVscodeModels()).map((m) => m.id)).toEqual(['gpt-5-mini']);
  });

  it('shows one entry per model name, preferring the public id over internal aliases', async () => {
    selectChatModels.mockResolvedValue([
      model('gpt-4o-mini', 'GPT-4o mini', 12_078),
      model('copilot-utility-small', 'GPT-4o mini', 12_078),
      model('copilot-dictation-cleanup-luna', 'GPT-5.6 Luna', 921_793),
      model('gpt-5.6-luna', 'GPT-5.6 Luna', 921_793),
    ] as never);

    expect((await listVscodeModels()).map((m) => m.id)).toEqual(['gpt-4o-mini', 'gpt-5.6-luna']);
  });

  it('still uses a saved model that the list hides as an alias', async () => {
    const alias = { ...fakeModel('copilot-utility-small', 'gpt'), name: 'GPT-4o mini' };
    const visible = { ...fakeModel('gpt-4o-mini', 'gpt'), name: 'GPT-4o mini' };
    selectChatModels.mockResolvedValue([visible, alias]);

    await new VscodeLmProvider('copilot-utility-small').complete(request);

    expect(alias.sendRequest).toHaveBeenCalled();
  });

  it('keeps same-named models from different vendors apart', async () => {
    selectChatModels.mockResolvedValue([
      model('auto', 'Auto', 100),
      model('auto', 'Auto', 100, 'other-ext'),
    ] as never);

    expect((await listVscodeModels()).map((m) => m.vendor)).toEqual(['copilot', 'other-ext']);
  });
});
