import { z } from 'zod';
import { readJson, writeJson } from './jsonFile';

const MAX_TRANSCRIPTS = 30;

const TranscriptSchema = z.object({
  id: z.string(),
  startedAt: z.number(),
  updatedAt: z.number(),
  filePath: z.string(),
  line: z.number(),
  done: z.boolean(),
  correct: z.number(),
  partly: z.number(),
  revealed: z.number(),
  skipped: z.number(),
  total: z.number(),
  /** The question texts, for the history list. */
  questions: z.array(z.string()).default([]),
  messages: z.array(z.object({ from: z.enum(['tutor', 'you']), text: z.string() })),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

const FileSchema = z.object({ version: z.literal(1), transcripts: z.array(TranscriptSchema) });
type TranscriptFile = z.infer<typeof FileSchema>;

/**
 * Past quiz conversations, newest first, saved to one JSON file on this
 * machine only. A quiz is saved again whenever it changes, so an abandoned
 * quiz keeps the answers it got.
 */
export class TranscriptStore {
  private data: TranscriptFile | undefined;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly filePath: string) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async save(transcript: Transcript): Promise<void> {
    const data = await this.load();
    const others = data.transcripts.filter((t) => t.id !== transcript.id);
    data.transcripts = [transcript, ...others]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, MAX_TRANSCRIPTS);
    await this.persist(data);
  }

  async list(): Promise<Transcript[]> {
    return [...(await this.load()).transcripts];
  }

  async get(id: string): Promise<Transcript | undefined> {
    return (await this.load()).transcripts.find((t) => t.id === id);
  }

  async clear(): Promise<void> {
    await this.persist({ version: 1, transcripts: [] });
  }

  private async load(): Promise<TranscriptFile> {
    this.data ??= (await readJson(this.filePath, FileSchema)) ?? { version: 1, transcripts: [] };
    return this.data;
  }

  private async persist(data: TranscriptFile): Promise<void> {
    this.data = data;
    this.writing = this.writing.then(() => writeJson(this.filePath, data));
    await this.writing;
    this.listeners.forEach((listener) => listener());
  }
}
