import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { LLMProvider } from '../../src/llm/provider';
import { completeStructured, extractJson, parseJson } from '../../src/llm/structured';
import { renderTemplate } from '../../src/prompts/render';

const Schema = z.object({ answer: z.string(), score: z.number() });

function providerReplying(...replies: string[]) {
  const complete = vi.fn<LLMProvider['complete']>();
  for (const reply of replies) {
    complete.mockResolvedValueOnce(reply);
  }
  return { provider: { id: 'vscodeLm', name: 'fake', complete } satisfies LLMProvider, complete };
}

const request = { system: 'sys', user: 'question', maxTokens: 100 };

describe('extractJson', () => {
  it('strips code fences and surrounding prose', () => {
    expect(extractJson('Sure!\n```json\n{"a": 1}\n```\nHope that helps')).toBe('{"a": 1}');
    expect(extractJson('Here you go: {"a": {"b": 2}} done')).toBe('{"a": {"b": 2}}');
  });
});

describe('parseJson', () => {
  it('validates against the schema', () => {
    expect(parseJson('{"answer":"x","score":1}', Schema)).toEqual({
      ok: true,
      value: { answer: 'x', score: 1 },
    });
    const bad = parseJson('{"answer":"x"}', Schema);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/score/);
  });

  it('reports invalid JSON', () => {
    const bad = parseJson('not json at all', Schema);
    expect(!bad.ok && bad.error).toMatch(/Not valid JSON/);
  });
});

describe('completeStructured', () => {
  it('returns the parsed value on the first try', async () => {
    const { provider, complete } = providerReplying('{"answer":"yes","score":3}');

    const result = await completeStructured(provider, request, Schema);

    expect(result).toEqual({ ok: true, value: { answer: 'yes', score: 3 }, attempts: 1 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('retries once with the validation error and the previous reply', async () => {
    const { provider, complete } = providerReplying(
      '{"answer":"yes"}',
      '{"answer":"yes","score":3}',
    );

    const result = await completeStructured(provider, request, Schema);

    expect(result).toMatchObject({ ok: true, attempts: 2 });
    const retryUser = complete.mock.calls[1]?.[0].user ?? '';
    expect(retryUser.startsWith('question')).toBe(true);
    expect(retryUser).toContain('{"answer":"yes"}');
    expect(retryUser).toMatch(/score/);
  });

  it('falls back to raw text after a second failure', async () => {
    const { provider } = providerReplying('nope', 'still prose');

    const result = await completeStructured(provider, request, Schema);

    expect(result).toMatchObject({ ok: false, raw: 'still prose', attempts: 2 });
  });

  it('lets provider errors propagate', async () => {
    const complete = vi.fn<LLMProvider['complete']>().mockRejectedValue(new Error('down'));

    await expect(
      completeStructured({ id: 'vscodeLm', name: 'fake', complete }, request, Schema),
    ).rejects.toThrow('down');
  });
});

describe('renderTemplate', () => {
  it('fills placeholders and rejects missing ones', () => {
    expect(renderTemplate('Hi {{name}}!', { name: 'Ada' })).toBe('Hi Ada!');
    expect(() => renderTemplate('{{missing}}', {})).toThrow(/missing/);
  });
});
