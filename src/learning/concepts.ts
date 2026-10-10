import type { Outcome } from './quizSession';

// Common spellings the models produce, mapped to the vocabulary in the prompts.
const SYNONYMS: Record<string, string> = {
  async: 'async-await',
  'async-and-await': 'async-await',
  asynchronous: 'async-await',
  'asynchronous-programming': 'async-await',
  await: 'async-await',
  promise: 'promises',
  callback: 'callbacks',
  closure: 'closures',
  'lexical-scope': 'scope',
  'variable-scope': 'scope',
  exceptions: 'error-handling',
  'exception-handling': 'error-handling',
  'error-checking': 'error-handling',
  'null-checks': 'null-safety',
  'null-checking': 'null-safety',
  'optional-chaining': 'null-safety',
  'type-guards': 'type-narrowing',
  'string-interpolation': 'string-formatting',
  'template-literals': 'string-formatting',
  'template-strings': 'string-formatting',
  'f-strings': 'string-formatting',
  validation: 'input-validation',
  'argument-validation': 'input-validation',
  'edge-case': 'edge-cases',
  'boundary-conditions': 'edge-cases',
  'off-by-one-errors': 'off-by-one',
  loops: 'iteration',
  looping: 'iteration',
  'array-method': 'array-methods',
  'react-hook': 'react-hooks',
  useeffect: 'react-effects',
  usestate: 'react-state',
  'race-condition': 'race-conditions',
  regex: 'regular-expressions',
  'regular-expression': 'regular-expressions',
  imports: 'modules-and-imports',
  modules: 'modules-and-imports',
  'env-vars': 'environment-variables',
  'unit-testing': 'testing',
  tests: 'testing',
  'data-structure': 'data-structures',
};

/** Lowercase, hyphenated, and mapped to the shared vocabulary where a synonym is known. */
export function normalizeConcept(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\s_/]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return SYNONYMS[slug] ?? slug;
}

/** How much an outcome counts toward mastery; undefined means it is not recorded. */
export function creditFor(outcome: Outcome): number | undefined {
  switch (outcome) {
    case 'correct':
      return 1;
    case 'partly':
      return 0.5;
    case 'wrong':
    case 'revealed':
      return 0;
    case 'skipped':
    case 'ungraded':
      return undefined;
  }
}

export interface Attempt {
  /** Milliseconds since the epoch. */
  at: number;
  /** 1 correct, 0.5 partly, 0 wrong or revealed. */
  credit: number;
}

export const HALF_LIFE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Mastery from 0 to 1: the average credit, with each attempt's weight halving
 * every HALF_LIFE_DAYS so recent answers matter most.
 */
export function masteryScore(attempts: readonly Attempt[], now: number): number | undefined {
  let weighted = 0;
  let total = 0;
  for (const attempt of attempts) {
    const ageDays = Math.max(now - attempt.at, 0) / DAY_MS;
    const weight = 0.5 ** (ageDays / HALF_LIFE_DAYS);
    weighted += weight * attempt.credit;
    total += weight;
  }
  return total > 0 ? weighted / total : undefined;
}

export type MasteryLevel = 'weak' | 'shaky' | 'solid';

export function masteryLevel(score: number): MasteryLevel {
  return score < 0.5 ? 'weak' : score < 0.8 ? 'shaky' : 'solid';
}
