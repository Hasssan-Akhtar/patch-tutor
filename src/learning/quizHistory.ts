/** Recent questions per hunk, newest last, so a new round can avoid repeats. */
export type QuizHistoryData = Record<string, string[]>;

export const MAX_QUESTIONS_PER_HUNK = 9;
export const MAX_HUNKS = 200;

/** Adds questions for a hunk, keeping the newest per hunk and the most recently quizzed hunks. */
export function addToHistory(
  data: QuizHistoryData,
  hunkId: string,
  questions: string[],
): QuizHistoryData {
  const merged = [...(data[hunkId] ?? []), ...questions].slice(-MAX_QUESTIONS_PER_HUNK);
  // Re-inserting moves the hunk to the end, so the oldest hunks are dropped first.
  const others = Object.entries(data).filter(([id]) => id !== hunkId);
  return Object.fromEntries([...others, [hunkId, merged]].slice(-MAX_HUNKS));
}

export interface HistoryStorage {
  get(): QuizHistoryData;
  set(data: QuizHistoryData): Thenable<void> | Promise<void>;
}

export class QuizHistory {
  constructor(private readonly storage: HistoryStorage) {}

  previous(hunkId: string): string[] {
    return this.storage.get()[hunkId] ?? [];
  }

  async record(hunkId: string, questions: string[]): Promise<void> {
    await this.storage.set(addToHistory(this.storage.get(), hunkId, questions));
  }
}
