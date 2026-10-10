// Minimal stand-in for the `vscode` module so pure-ish adapters can run under Vitest.
// Only what the code under test touches is implemented.
import { vi } from 'vitest';

export class CancellationError extends Error {}

export class CancellationTokenSource {
  readonly token = { isCancellationRequested: false };
  cancel(): void {
    this.token.isCancellationRequested = true;
  }
  dispose(): void {}
}

export class LanguageModelChatMessage {
  constructor(
    readonly role: 'user' | 'assistant',
    readonly content: string,
  ) {}
  static User(content: string): LanguageModelChatMessage {
    return new LanguageModelChatMessage('user', content);
  }
}

export class LanguageModelError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
  static NoPermissions(message = ''): LanguageModelError {
    return new LanguageModelError(message, 'NoPermissions');
  }
  static Blocked(message = ''): LanguageModelError {
    return new LanguageModelError(message, 'Blocked');
  }
  static NotFound(message = ''): LanguageModelError {
    return new LanguageModelError(message, 'NotFound');
  }
}

export const lm = {
  selectChatModels: vi.fn(),
};
