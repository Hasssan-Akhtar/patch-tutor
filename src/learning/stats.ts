import type { ActivityEntry } from './conceptStore';
import { creditFor } from './concepts';
import { localDay } from '../services/usage';

export interface ProgressStats {
  /** Questions answered or revealed; skips are not counted. */
  answered: number;
  /** Average credit over counted answers in the last 30 days, 0 to 1; undefined without any. */
  accuracy: number | undefined;
  /** Consecutive days with at least one answer, ending today or yesterday. */
  streakDays: number;
  /** Counted answers since local midnight. */
  answeredToday: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCURACY_WINDOW_DAYS = 30;

export function progressStats(activity: readonly ActivityEntry[], now: number): ProgressStats {
  const counted = activity.flatMap((a) => {
    const credit = creditFor(a.outcome);
    return credit === undefined ? [] : [{ at: a.at, credit }];
  });
  const recent = counted.filter((a) => now - a.at <= ACCURACY_WINDOW_DAYS * DAY_MS);
  const today = localDay(new Date(now));

  return {
    answered: counted.length,
    accuracy:
      recent.length > 0 ? recent.reduce((n, a) => n + a.credit, 0) / recent.length : undefined,
    streakDays: streak(new Set(counted.map((a) => localDay(new Date(a.at)))), now),
    answeredToday: counted.filter((a) => localDay(new Date(a.at)) === today).length,
  };
}

function streak(days: Set<string>, now: number): number {
  // A streak still counts if today has no answers yet but yesterday did.
  // Step by calendar day, not 24h, so daylight-saving changes cannot skip a day.
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
