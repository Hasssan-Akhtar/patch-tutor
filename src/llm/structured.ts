import { z } from 'zod';
import fixJsonPrompt from '../prompts/fix-json.md';
import { renderTemplate } from '../prompts/render';
import type { CompletionRequest, LLMProvider } from './provider';

export type StructuredResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; raw: string; error: string; attempts: number };

/**
 * Asks for JSON and validates it with `schema`. On invalid output it retries
 * once, telling the model what was wrong; if that fails too, the raw text is
 * returned so the UI can still show something. Provider errors propagate.
 */
export async function completeStructured<T>(
  provider: LLMProvider,
  request: CompletionRequest,
  schema: z.ZodType<T>,
): Promise<StructuredResult<T>> {
  const first = await provider.complete({ ...request, json: true });
  const firstResult = parseJson(first, schema);
  if (firstResult.ok) {
    return { ok: true, value: firstResult.value, attempts: 1 };
  }

  const retry = await provider.complete({
    ...request,
    json: true,
    user:
      request.user +
      '\n\n' +
      renderTemplate(fixJsonPrompt, { previous: first, error: firstResult.error }),
  });
  const retryResult = parseJson(retry, schema);
  if (retryResult.ok) {
    return { ok: true, value: retryResult.value, attempts: 2 };
  }
  return { ok: false, raw: retry, error: retryResult.error, attempts: 2 };
}

export function parseJson<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; value: T } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(extractJson(text));
  } catch (error) {
    return { ok: false, error: `Not valid JSON: ${(error as Error).message}` };
  }
  const parsed = schema.safeParse(data);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: z.prettifyError(parsed.error) };
}

/** Strips code fences and any prose around the outermost JSON object. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  // When the reply is the object, bare or fenced, take it whole: strings inside
  // it may hold code fences of their own, such as a dry run's code block.
  if (/^(```(?:json)?\s*)?\{/i.test(trimmed)) {
    return outermostObject(trimmed);
  }
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  return outermostObject(fenced?.[1] ?? trimmed);
}

function outermostObject(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? text.slice(start, end + 1) : text.trim();
}
