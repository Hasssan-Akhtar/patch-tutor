export interface DailyUsage {
  /** Local date as YYYY-MM-DD. */
  day: string;
  tokens: number;
}

export function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Adds tokens to today's total, starting over when the day changes. */
export function addUsage(
  current: DailyUsage | undefined,
  today: string,
  tokens: number,
): DailyUsage {
  return current?.day === today
    ? { day: today, tokens: current.tokens + tokens }
    : { day: today, tokens };
}

export function tokensToday(current: DailyUsage | undefined, today: string): number {
  return current?.day === today ? current.tokens : 0;
}

export function formatTokens(tokens: number): string {
  if (tokens < 1000) {
    return String(tokens);
  }
  const thousands = tokens / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands)}k`;
}
