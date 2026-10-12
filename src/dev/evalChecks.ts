import { z } from 'zod';
import type { Explanation } from '../llm/schemas';

const PhraseSchema = z.object({
  /** A case-insensitive regular expression. */
  pattern: z.string().min(1),
  /** Why it matters, shown in the report. */
  why: z.string().min(1),
});

/**
 * What a good explanation of one fixture must and must not say. Results are
 * shown as warnings in the eval report, since small models miss some.
 */
export const EvalChecksSchema = z.object({
  mustNotSay: z.array(PhraseSchema).default([]),
  shouldSay: z.array(PhraseSchema).default([]),
  forbiddenConcepts: z.array(z.string()).default([]),
});
export type EvalChecks = z.infer<typeof EvalChecksSchema>;

export interface CheckResult {
  ok: boolean;
  label: string;
}

const FIELDS = ['summary', 'whatChanged', 'howItWorks', 'whyItWorks', 'risks'] as const;

export function runChecks(explanation: Explanation, checks: EvalChecks): CheckResult[] {
  const fields = FIELDS.map((name) => {
    const value = explanation[name];
    return { name, text: Array.isArray(value) ? value.join('\n') : value };
  });
  const firstMatch = (pattern: string) => {
    const regex = new RegExp(pattern, 'i');
    return fields.find((f) => regex.test(f.text))?.name;
  };
  const concepts = new Set(explanation.concepts.map((c) => c.toLowerCase()));

  return [
    ...checks.mustNotSay.map(({ pattern, why }) => {
      const found = firstMatch(pattern);
      return found
        ? { ok: false, label: `must not say: ${why} (found in ${found})` }
        : { ok: true, label: `must not say: ${why}` };
    }),
    ...checks.shouldSay.map(({ pattern, why }) => ({
      ok: firstMatch(pattern) !== undefined,
      label: `should say: ${why}`,
    })),
    ...checks.forbiddenConcepts.map((concept) => ({
      ok: !concepts.has(concept.toLowerCase()),
      label: `concept not tagged: ${concept}`,
    })),
  ];
}

/** Markdown lines for the eval report. */
export function checksReport(results: readonly CheckResult[]): string[] {
  const passed = results.filter((r) => r.ok).length;
  return [
    `**Checks:** ${passed}/${results.length} passed (warnings, not failures)`,
    '',
    ...results.map((r) => `- ${r.ok ? '✅' : '⚠️'} ${r.label}`),
  ];
}
