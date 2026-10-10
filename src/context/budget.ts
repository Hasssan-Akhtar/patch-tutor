import { estimateTokens } from './tokens';

export interface ContextSection {
  title: string;
  text: string;
  /** Higher is more valuable; lower-priority sections are dropped first. */
  priority: number;
  /** Trimmed to fit instead of dropped when it is the next most valuable section. */
  truncatable?: boolean;
}

export interface BudgetResult {
  kept: ContextSection[];
  dropped: string[];
  tokens: number;
}

const MIN_TRUNCATED_LINES = 10;

/**
 * Keeps the most valuable sections that fit in `budget` tokens. Kept sections
 * stay in their original order so the prompt reads naturally.
 */
export function fitToBudget(sections: ContextSection[], budget: number): BudgetResult {
  const byValue = [...sections].sort((a, b) => b.priority - a.priority);
  const keep = new Map<ContextSection, ContextSection>();
  const dropped: string[] = [];
  let remaining = budget;

  for (const section of byValue) {
    const cost = estimateTokens(section.text);
    if (cost <= remaining) {
      keep.set(section, section);
      remaining -= cost;
      continue;
    }
    const trimmed = section.truncatable ? truncateLines(section.text, remaining) : undefined;
    if (trimmed) {
      keep.set(section, { ...section, text: trimmed });
      remaining -= estimateTokens(trimmed);
    } else {
      dropped.push(section.title);
    }
  }

  const kept = sections.flatMap((s) => {
    const k = keep.get(s);
    return k ? [k] : [];
  });
  return { kept, dropped, tokens: budget - remaining };
}

/** Keeps leading lines that fit, or returns undefined if too few would remain. */
export function truncateLines(text: string, budget: number): string | undefined {
  const marker = '… (truncated)';
  const lines = text.split('\n');
  const out: string[] = [];
  let used = estimateTokens(marker);
  for (const line of lines) {
    const cost = estimateTokens(line + '\n');
    if (used + cost > budget) {
      break;
    }
    out.push(line);
    used += cost;
  }
  if (out.length < Math.min(MIN_TRUNCATED_LINES, lines.length)) {
    return undefined;
  }
  return out.length === lines.length ? text : [...out, marker].join('\n');
}
