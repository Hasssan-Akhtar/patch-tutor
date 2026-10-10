import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { masteryScore, normalizeConcept, type Attempt } from './concepts';

const MAX_ATTEMPTS_PER_CONCEPT = 50;
const MAX_HUNKS_PER_CONCEPT = 10;
const MAX_DIFF_LINES = 60;

const HunkRefSchema = z.object({
  hunkId: z.string(),
  filePath: z.string(),
  /** First changed line in the new file, 1-based. */
  line: z.number(),
  /** The hunk as quizzed, so it can be shown after it is committed or changed. */
  diff: z.string(),
  lastSeen: z.number(),
});
export type HunkRef = z.infer<typeof HunkRefSchema>;

const ConceptSchema = z.object({
  attempts: z.array(z.object({ at: z.number(), credit: z.number() })),
  hunks: z.array(HunkRefSchema),
});

const FileSchema = z.object({
  version: z.literal(1),
  concepts: z.record(z.string(), ConceptSchema),
});
type StoreFile = z.infer<typeof FileSchema>;

export interface ConceptSummary {
  name: string;
  /** 0 to 1, recent attempts weighted most. */
  score: number;
  attempts: number;
  correct: number;
  lastSeen: number;
  hunks: HunkRef[];
}

export interface RecordedAnswer {
  concept: string;
  credit: number;
  hunk: Omit<HunkRef, 'lastSeen'>;
}

/**
 * Quiz results per concept, saved to one JSON file on this machine only.
 * Concept names are normalized so different spellings share a history.
 */
export class ConceptStore {
  private data: StoreFile | undefined;
  private writing: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async record(answer: RecordedAnswer): Promise<void> {
    const name = normalizeConcept(answer.concept);
    if (!name) {
      return;
    }
    const data = await this.load();
    const now = this.now();
    const concept = data.concepts[name] ?? { attempts: [], hunks: [] };
    concept.attempts = [...concept.attempts, { at: now, credit: answer.credit }].slice(
      -MAX_ATTEMPTS_PER_CONCEPT,
    );
    const ref: HunkRef = { ...answer.hunk, diff: trimLines(answer.hunk.diff), lastSeen: now };
    concept.hunks = [ref, ...concept.hunks.filter((h) => h.hunkId !== ref.hunkId)].slice(
      0,
      MAX_HUNKS_PER_CONCEPT,
    );
    data.concepts[name] = concept;
    await this.save(data);
  }

  /** All concepts, weakest first; ties go to the most recently practised. */
  async summaries(): Promise<ConceptSummary[]> {
    const data = await this.load();
    const now = this.now();
    return Object.entries(data.concepts)
      .flatMap(([name, concept]) => {
        const score = masteryScore(concept.attempts, now);
        if (score === undefined) {
          return [];
        }
        return [
          {
            name,
            score,
            attempts: concept.attempts.length,
            correct: concept.attempts.filter((a: Attempt) => a.credit === 1).length,
            lastSeen: Math.max(...concept.attempts.map((a) => a.at)),
            hunks: concept.hunks,
          },
        ];
      })
      .sort((a, b) => a.score - b.score || b.lastSeen - a.lastSeen);
  }

  async clear(): Promise<void> {
    await this.save({ version: 1, concepts: {} });
  }

  private async load(): Promise<StoreFile> {
    if (!this.data) {
      try {
        this.data = FileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')));
      } catch {
        // Missing or unreadable: start fresh rather than fail the quiz.
        this.data = { version: 1, concepts: {} };
      }
    }
    return this.data;
  }

  private async save(data: StoreFile): Promise<void> {
    this.data = data;
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, this.filePath);
    });
    await this.writing;
    this.listeners.forEach((listener) => listener());
  }
}

function trimLines(text: string): string {
  const lines = text.split('\n');
  return lines.length <= MAX_DIFF_LINES
    ? text
    : [...lines.slice(0, MAX_DIFF_LINES), '… (truncated)'].join('\n');
}
