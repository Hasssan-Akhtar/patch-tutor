import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A thread the user flagged as wrong, kept locally to improve prompts. */
export interface WrongReport {
  reportedAt: string;
  filePath: string;
  hunkId: string;
  diff: string;
  model: string;
  explainPromptVersion: string;
  /** The thread as shown, one Markdown string per comment. */
  comments: string[];
}

/** Appends reports to a local JSON Lines file. Nothing is sent anywhere. */
export class ReportStore {
  constructor(readonly filePath: string) {}

  async add(report: WrongReport): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(report) + '\n');
  }
}
