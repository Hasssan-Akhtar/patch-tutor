import * as vscode from 'vscode';
import { ProviderError, type CompletionRequest, type LLMProvider } from './provider';

const PREFERRED_VENDOR = 'copilot';
const JUSTIFICATION =
  'Patch Tutor uses a language model to explain your code changes and quiz you on them.';

/**
 * Uses models VS Code already provides: GitHub Copilot, or any extension that
 * registers models through the stable Language Model API. No API key is needed.
 */
export class VscodeLmProvider implements LLMProvider {
  readonly id = 'vscodeLm';
  readonly name = 'VS Code models';

  /** @param model a model id or family; empty picks the first available model. */
  constructor(private readonly model: string) {}

  async complete(request: CompletionRequest): Promise<string> {
    const chat = await this.selectModel();
    const tokenSource = new vscode.CancellationTokenSource();
    const cancel = () => tokenSource.cancel();
    request.signal?.addEventListener('abort', cancel);

    try {
      throwIfAborted(request.signal);
      // The stable API has no system role, so instructions go first as a user message.
      // It also has no portable max-tokens option; request.maxTokens is a budget
      // the prompts must respect.
      const messages = [
        vscode.LanguageModelChatMessage.User(request.system),
        vscode.LanguageModelChatMessage.User(request.user),
      ];
      const response = await chat.sendRequest(
        messages,
        { justification: JUSTIFICATION },
        tokenSource.token,
      );

      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
      }
      throwIfAborted(request.signal);
      return text;
    } catch (error) {
      throw toProviderError(error, request.signal);
    } finally {
      request.signal?.removeEventListener('abort', cancel);
      tokenSource.dispose();
    }
  }

  private async selectModel(): Promise<vscode.LanguageModelChat> {
    const models = await listVscodeModels();
    if (models.length === 0) {
      throw new ProviderError(
        'No language models are available in VS Code. Install GitHub Copilot (or another extension that provides models) and sign in, then try again.',
        'notFound',
      );
    }
    if (!this.model) {
      return models[0] as vscode.LanguageModelChat;
    }
    const match = models.find((m) => m.id === this.model || m.family === this.model);
    if (!match) {
      const available = models.map((m) => m.family).join(', ');
      throw new ProviderError(
        `Model "${this.model}" was not found in VS Code. Available: ${available}.`,
        'notFound',
      );
    }
    return match;
  }
}

/** Every model VS Code offers, Copilot's first so an empty setting picks one of them. */
export async function listVscodeModels(): Promise<vscode.LanguageModelChat[]> {
  const models = await vscode.lm.selectChatModels();
  const rank = (m: vscode.LanguageModelChat) => (m.vendor === PREFERRED_VENDOR ? 0 : 1);
  return [...models].sort((a, b) => rank(a) - rank(b));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new ProviderError('Request was cancelled.', 'cancelled');
  }
}

function toProviderError(error: unknown, signal: AbortSignal | undefined): ProviderError {
  if (error instanceof ProviderError) {
    return error;
  }
  if (signal?.aborted || error instanceof vscode.CancellationError) {
    return new ProviderError('Request was cancelled.', 'cancelled', { cause: error });
  }
  if (error instanceof vscode.LanguageModelError) {
    switch (error.code) {
      case vscode.LanguageModelError.NoPermissions.name:
        return new ProviderError(
          'Patch Tutor is not allowed to use this model. Run the command again and choose Allow.',
          'auth',
          { cause: error },
        );
      case vscode.LanguageModelError.Blocked.name:
        return new ProviderError(
          'The model provider blocked the request, usually because a rate limit or quota was reached. Try again later.',
          'rateLimit',
          { cause: error },
        );
      case vscode.LanguageModelError.NotFound.name:
        return new ProviderError('The selected model is no longer available.', 'notFound', {
          cause: error,
        });
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ProviderError(`VS Code model request failed: ${message}`, 'unknown', { cause: error });
}
