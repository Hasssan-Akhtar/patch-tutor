import { describe, expect, it, vi } from 'vitest';
import { metered } from '../../src/llm/metered';
import type { LLMProvider } from '../../src/llm/provider';
import { addUsage, formatTokens, localDay, tokensToday } from '../../src/services/usage';

describe('daily usage', () => {
  it('accumulates within a day and restarts on a new day', () => {
    const first = addUsage(undefined, '2026-10-11', 100);
    const second = addUsage(first, '2026-10-11', 50);
    const nextDay = addUsage(second, '2026-10-12', 10);

    expect(second).toEqual({ day: '2026-10-11', tokens: 150 });
    expect(nextDay).toEqual({ day: '2026-10-12', tokens: 10 });
    expect(tokensToday(second, '2026-10-12')).toBe(0);
  });

  it('formats a local date as YYYY-MM-DD', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('formats token counts compactly', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1234)).toBe('1.2k');
    expect(formatTokens(45678)).toBe('46k');
  });
});

describe('metered', () => {
  it('reports estimated input and output tokens after each request', async () => {
    const complete = vi.fn<LLMProvider['complete']>().mockResolvedValue('abcd'.repeat(5));
    const onUsage = vi.fn();
    const provider = metered({ id: 'vscodeLm', name: 'fake', complete }, onUsage);

    const reply = await provider.complete({ system: 'abcd', user: 'abcdabcd', maxTokens: 10 });

    expect(reply).toBe('abcd'.repeat(5));
    expect(onUsage).toHaveBeenCalledWith(1 + 2 + 5);
  });

  it('reports nothing when the request fails', async () => {
    const complete = vi.fn<LLMProvider['complete']>().mockRejectedValue(new Error('down'));
    const onUsage = vi.fn();

    await expect(
      metered({ id: 'vscodeLm', name: 'fake', complete }, onUsage).complete({
        system: '',
        user: '',
        maxTokens: 1,
      }),
    ).rejects.toThrow('down');
    expect(onUsage).not.toHaveBeenCalled();
  });
});
