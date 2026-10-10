import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { creditFor, masteryScore, normalizeConcept, type Attempt } from './concepts';
import type { Outcome } from './quizSession';

const MAX_ATTEMPTS_PER_CONCEPT = 50;
const MAX_HUNKS_PER_CONCEPT = 10;
const MAX_ACTIVITY = 200;
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

const ActivitySchema = z.object({
  at: z.number(),
  concept: z.string(),
  outcome: z.enum(['correct', 'partly', 'wrong', 'revealed', 'skipped', 'ungraded']),
  question: z.string(),
  filePath: z.string(),
  hunkId: z.string(),
  /** Added later; older entries may lack them. */
  line: z.number().optional(),
  answer: z.string().optional(),
  feedback: z.string().optional(),
  expected: z.string().optional(),
  remember: z.string().optional(),
});
export type ActivityEntry = z.infer<typeof ActivitySchema>;

const FileSchema = z.object({
  version: z.literal(1),
  concepts: z.record(z.string(), ConceptSchema),
  /** Newest first. Added after the first release of this file, so it may be missing. */
  activity: z.array(ActivitySchema).default([]),
  /** Lifetime count of scored answers (attempts are capped per concept). Derived when missing. */
  answeredTotal: z.number().optional(),
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
  outcome: Outcome;
  question: string;
  hunk: Omit<HunkRef, 'lastSeen'>;
  answer?: string;
  feedback?: string;
  expected?: string;
  remember?: string;
}

/**
 * Quiz results per concept plus a log of recent answers, saved to one JSON
 * file on this machine only. Concept names are normalized so different
 * spellings share a history.
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

    const credit = creditFor(answer.outcome);
    if (credit !== undefined) {
      concept.attempts = [...concept.attempts, { at: now, credit }].slice(
        -MAX_ATTEMPTS_PER_CONCEPT,
      );
      data.answeredTotal = answeredTotal(data) + 1;
    }
    const ref: HunkRef = { ...answer.hunk, diff: trimLines(answer.hunk.diff), lastSeen: now };
    concept.hunks = [ref, ...concept.hunks.filter((h) => h.hunkId !== ref.hunkId)].slice(
      0,
      MAX_HUNKS_PER_CONCEPT,
    );
    data.concepts[name] = concept;

    const entry: ActivityEntry = {
      at: now,
      concept: name,
      outcome: answer.outcome,
      question: answer.question,
      filePath: answer.hunk.filePath,
      hunkId: answer.hunk.hunkId,
      line: answer.hunk.line,
      answer: answer.answer,
      feedback: answer.feedback,
      expected: answer.expected,
      remember: answer.remember,
    };
    data.activity = [entry, ...data.activity].slice(0, MAX_ACTIVITY);
    await this.save(data);
  }

  /** Concepts with at least one counted attempt, weakest first; ties go to the most recent. */
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
            correct: concept.attempts.filter((a) => a.credit === 1).length,
            lastSeen: Math.max(...concept.attempts.map((a) => a.at)),
            hunks: concept.hunks,
          },
        ];
      })
      .sort((a, b) => a.score - b.score || b.lastSeen - a.lastSeen);
  }

  /** Recent answers, newest first. */
  async activity(): Promise<ActivityEntry[]> {
    return [...(await this.load()).activity];
  }

  /**
   * What the progress tiles are computed from: the same scored attempts the
   * concept bars use, plus the lifetime count, so the numbers always agree.
   */
  async progressInputs(): Promise<{ answeredTotal: number; attempts: Attempt[] }> {
    const data = await this.load();
    return {
      answeredTotal: answeredTotal(data),
      attempts: Object.values(data.concepts).flatMap((c) => c.attempts),
    };
  }

  /** The saved change a concept or activity entry points at. */
  async findHunk(hunkId: string): Promise<HunkRef | undefined> {
    const data = await this.load();
    for (const concept of Object.values(data.concepts)) {
      const ref = concept.hunks.find((h) => h.hunkId === hunkId);
      if (ref) {
        return ref;
      }
    }
    return undefined;
  }

  async clear(): Promise<void> {
    await this.save({ version: 1, concepts: {}, activity: [], answeredTotal: 0 });
  }

  private async load(): Promise<StoreFile> {
    if (!this.data) {
      try {
        this.data = FileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')));
      } catch {
        // Missing or unreadable: start fresh rather than fail the quiz.
        this.data = { version: 1, concepts: {}, activity: [] };
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

/** Files written before the counter existed get it from the attempts they hold. */
function answeredTotal(data: StoreFile): number {
  return (
    data.answeredTotal ?? Object.values(data.concepts).reduce((n, c) => n + c.attempts.length, 0)
  );
}

function trimLines(text: string): string {
  const lines = text.split('\n');
  return lines.length <= MAX_DIFF_LINES
    ? text
    : [...lines.slice(0, MAX_DIFF_LINES), '… (truncated)'].join('\n');
}
