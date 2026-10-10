import { estimateTokens } from '../context/tokens';
import type { LLMProvider } from './provider';

/** Wraps a provider to report estimated tokens (input + output) for each completed request. */
export function metered(provider: LLMProvider, onUsage: (tokens: number) => void): LLMProvider {
  return {
    id: provider.id,
    name: provider.name,
    async complete(request) {
      const reply = await provider.complete(request);
      onUsage(
        estimateTokens(request.system) + estimateTokens(request.user) + estimateTokens(reply),
      );
      return reply;
    },
  };
}
