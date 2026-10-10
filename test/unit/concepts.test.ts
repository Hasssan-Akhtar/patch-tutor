import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConceptStore } from '../../src/learning/conceptStore';
import {
  creditFor,
  HALF_LIFE_DAYS,
  masteryLevel,
  masteryScore,
  normalizeConcept,
} from '../../src/learning/concepts';

const DAY = 24 * 60 * 60 * 1000;

describe('normalizeConcept', () => {
  it.each([
    ['Async/Await', 'async-await'],
    ['  async await ', 'async-await'],
    ['Asynchronous Programming', 'async-await'],
    ['error_handling', 'error-handling'],
    ['Exceptions', 'error-handling'],
    ['Template Literals', 'string-formatting'],
    ['closure', 'closures'],
    ['useEffect', 'react-effects'],
    ['SQL Joins!', 'sql-joins'],
    ['some-new-term', 'some-new-term'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeConcept(input)).toBe(expected);
  });

  it('returns an empty string for names without letters or digits', () => {
    expect(normalizeConcept(' -- ')).toBe('');
  });
});

describe('creditFor', () => {
  it('gives full, half or no credit, and skips skipped or ungraded answers', () => {
    expect(creditFor('correct')).toBe(1);
    expect(creditFor('partly')).toBe(0.5);
    expect(creditFor('wrong')).toBe(0);
    expect(creditFor('revealed')).toBe(0);
    expect(creditFor('skipped')).toBeUndefined();
    expect(creditFor('ungraded')).toBeUndefined();
  });
});

describe('masteryScore', () => {
  const now = 100 * DAY;

  it('is the average credit when attempts are equally recent', () => {
    expect(
      masteryScore(
        [
          { at: now, credit: 1 },
          { at: now, credit: 0 },
          { at: now, credit: 0.5 },
        ],
        now,
      ),
    ).toBeCloseTo(0.5);
  });

  it('weights an attempt one half-life old half as much', () => {
    const score = masteryScore(
      [
        { at: now - HALF_LIFE_DAYS * DAY, credit: 0 },
        { at: now, credit: 1 },
      ],
      now,
    );

    expect(score).toBeCloseTo(1 / 1.5);
  });

  it('lets recent success outweigh old mistakes', () => {
    const oldMistakes = Array.from({ length: 5 }, () => ({ at: now - 60 * DAY, credit: 0 }));
    const recent = [{ at: now, credit: 1 }];

    expect(masteryScore([...oldMistakes, ...recent], now)).toBeGreaterThan(0.7);
  });

  it('is undefined without attempts', () => {
    expect(masteryScore([], now)).toBeUndefined();
  });

  it('maps scores to levels', () => {
    expect(masteryLevel(0.2)).toBe('weak');
    expect(masteryLevel(0.5)).toBe('shaky');
    expect(masteryLevel(0.8)).toBe('solid');
  });
});

describe('ConceptStore', () => {
  let dir: string;
  let file: string;
  let clock: number;
  const store = () => new ConceptStore(file, () => clock);
  const hunk = (id: string, diff = '@@ -1 +1 @@\n+x') => ({
    hunkId: id,
    filePath: 'src/a.ts',
    line: 3,
    diff,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-concepts-'));
    file = join(dir, 'nested', 'concepts.json');
    clock = 10 * DAY;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('merges spellings, persists, and sorts weakest first', async () => {
    const s = store();
    await s.record({ concept: 'Async/Await', outcome: 'wrong', question: 'Q?', hunk: hunk('h1') });
    await s.record({ concept: 'async await', outcome: 'partly', question: 'Q?', hunk: hunk('h2') });
    await s.record({ concept: 'closures', outcome: 'correct', question: 'Q?', hunk: hunk('h3') });

    const summaries = await store().summaries();

    expect(summaries.map((c) => [c.name, c.attempts, c.correct])).toEqual([
      ['async-await', 2, 0],
      ['closures', 1, 1],
    ]);
    expect(summaries[0]?.score).toBeCloseTo(0.25);
    expect(summaries[0]?.hunks.map((h) => h.hunkId)).toEqual(['h2', 'h1']);
  });

  it('keeps one entry per hunk, newest first, and trims long diffs', async () => {
    const s = store();
    const longDiff = Array.from({ length: 100 }, (_, i) => `+line ${i}`).join('\n');
    await s.record({ concept: 'scope', outcome: 'correct', question: 'Q?', hunk: hunk('h1') });
    await s.record({
      concept: 'scope',
      outcome: 'correct',
      question: 'Q?',
      hunk: hunk('h2', longDiff),
    });
    clock += DAY;
    await s.record({ concept: 'scope', outcome: 'wrong', question: 'Q?', hunk: hunk('h1') });

    const [scope] = await s.summaries();

    expect(scope?.hunks.map((h) => h.hunkId)).toEqual(['h1', 'h2']);
    expect(scope?.hunks[1]?.diff.split('\n').length).toBeLessThan(70);
    expect(scope?.hunks[1]?.diff).toMatch(/… \(truncated\)$/);
    expect(scope?.lastSeen).toBe(clock);
  });

  it('notifies listeners and clears everything', async () => {
    const s = store();
    let changes = 0;
    s.onDidChange(() => changes++);

    await s.record({ concept: 'scope', outcome: 'correct', question: 'Q?', hunk: hunk('h1') });
    await s.clear();

    expect(changes).toBe(2);
    expect(await s.summaries()).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      version: 1,
      concepts: {},
      activity: [],
      answeredTotal: 0,
    });
  });

  it('ignores blank concept names and starts fresh from a corrupt file', async () => {
    await store().record({ concept: '  ', outcome: 'correct', question: 'Q?', hunk: hunk('h1') });
    expect(await store().summaries()).toEqual([]);

    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ not json');
    expect(await store().summaries()).toEqual([]);
  });
});

describe('ConceptStore activity', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-activity-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('logs every answer newest first, but skips do not affect scores', async () => {
    let clock = 1000;
    const s = new ConceptStore(join(dir, 'c.json'), () => clock++);
    const hunk = { hunkId: 'h1', filePath: 'src/a.ts', line: 1, diff: '+x' };

    await s.record({ concept: 'Closure', outcome: 'correct', question: 'First?', hunk });
    await s.record({ concept: 'closures', outcome: 'skipped', question: 'Second?', hunk });

    const activity = await s.activity();
    expect(activity.map((a) => [a.question, a.outcome, a.concept])).toEqual([
      ['Second?', 'skipped', 'closures'],
      ['First?', 'correct', 'closures'],
    ]);
    const [closures] = await s.summaries();
    expect(closures).toMatchObject({ attempts: 1, score: 1 });
    expect((await s.findHunk('h1'))?.filePath).toBe('src/a.ts');
    expect(await s.findHunk('missing')).toBeUndefined();
  });

  it('reads files written before the activity log existed', async () => {
    const file = join(dir, 'old.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        concepts: { scope: { attempts: [{ at: 1, credit: 1 }], hunks: [] } },
      }),
    );

    const s = new ConceptStore(file, () => 2);

    expect(await s.activity()).toEqual([]);
    expect((await s.summaries()).map((c) => c.name)).toEqual(['scope']);
  });
});

describe('ConceptStore progress inputs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-progress-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the tiles consistent with the concept bars, including older files', async () => {
    // A file from before the activity log and counter: 2 string-formatting attempts.
    const file = join(dir, 'c.json');
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        concepts: {
          'string-formatting': {
            attempts: [
              { at: 1, credit: 1 },
              { at: 2, credit: 0 },
            ],
            hunks: [],
          },
        },
      }),
    );
    const s = new ConceptStore(file, () => 3);
    const hunk = { hunkId: 'h', filePath: 'a.js', line: 1, diff: '+x' };

    await s.record({ concept: 'async-await', outcome: 'correct', question: 'Q1', hunk });
    await s.record({ concept: 'async-await', outcome: 'partly', question: 'Q2', hunk });
    await s.record({ concept: 'async-await', outcome: 'skipped', question: 'Q3', hunk });

    const inputs = await s.progressInputs();
    const triesInBars = (await s.summaries()).reduce((n, c) => n + c.attempts, 0);
    expect(inputs.answeredTotal).toBe(4);
    expect(inputs.answeredTotal).toBe(triesInBars);
    expect(inputs.attempts).toHaveLength(4);

    await s.clear();
    expect((await s.progressInputs()).answeredTotal).toBe(0);
  });
});
