import type { Attempt } from './concepts';
import { localDay } from '../services/usage';

export interface ProgressStats {
  /** Lifetime scored answers (correct, partly, wrong or peeked); skips are not counted. */
  answered: number;
  /** Average credit over answers in the last 30 days, 0 to 1; undefined without any. */
  accuracy: number | undefined;
  /** Consecutive days with at least one answer, ending today or yesterday. */
  streakDays: number;
  /** Scored answers since local midnight. */
  answeredToday: number;
}

export interface ProgressInputs {
  answeredTotal: number;
  /** Scored attempts across all concepts, the same data the concept bars use. */
  attempts: readonly Attempt[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCURACY_WINDOW_DAYS = 30;

export function progressStats(inputs: ProgressInputs, now: number): ProgressStats {
  const { attempts } = inputs;
  const recent = attempts.filter((a) => now - a.at <= ACCURACY_WINDOW_DAYS * DAY_MS);
  const today = localDay(new Date(now));

  return {
    answered: inputs.answeredTotal,
    accuracy:
      recent.length > 0 ? recent.reduce((n, a) => n + a.credit, 0) / recent.length : undefined,
    streakDays: streak(new Set(attempts.map((a) => localDay(new Date(a.at)))), now),
    answeredToday: attempts.filter((a) => localDay(new Date(a.at)) === today).length,
  };
}

function streak(days: Set<string>, now: number): number {
  // Step by calendar day, not 24h, so daylight-saving changes cannot skip a day.
  // A streak still counts if today has no answers yet but yesterday did.
  const cursor = new Date(now);
  if (!days.has(localDay(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let count = 0;
  while (days.has(localDay(cursor))) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

/** "just now", "5m ago", "3h ago", "yesterday", "4d ago", then a date. */
export function timeAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) {
    return 'yesterday';
  }
  return days < 7 ? `${days}d ago` : new Date(at).toLocaleDateString();
}
