import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checksReport, EvalChecksSchema, runChecks } from '../../src/dev/evalChecks';
import { parseUnifiedDiff } from '../../src/git/diffParser';
import type { Explanation } from '../../src/llm/schemas';

const explanation: Explanation = {
  summary: 'Uses count() to check permissions.',
  whatChanged: '- Calls `count()` instead of `findMany()`.\n- Logs the number granted.',
  howItWorks: 'Each check returns a number.',
  whyItWorks: 'This reduces the number of database calls.',
  concepts: ['orm', 'input-validation'],
  risks: ['Callers relying on the old default order now get newest first.'],
  depth: 'standard',
};

describe('runChecks', () => {
  it('flags text that must not appear, case-insensitively, and names the field', () => {
    const [result] = runChecks(explanation, {
      mustNotSay: [
        { pattern: 'reduc\\w* the number of (database )?calls', why: 'same number of calls' },
      ],
      shouldSay: [],
      forbiddenConcepts: [],
    });
    expect(result).toEqual({
      ok: false,
      label: 'must not say: same number of calls (found in whyItWorks)',
    });
  });

  it('passes text that should appear anywhere, including risks', () => {
    const results = runChecks(explanation, {
      mustNotSay: [{ pattern: 'faster', why: 'no speed claim' }],
      shouldSay: [
        { pattern: '\\blogs?\\b', why: 'mentions the new log' },
        { pattern: 'old default', why: 'names the changed default' },
      ],
      forbiddenConcepts: [],
    });
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
  });

  it('flags forbidden concepts', () => {
    const results = runChecks(explanation, {
      mustNotSay: [],
      shouldSay: [],
      forbiddenConcepts: ['input-validation', 'async-await'],
    });
    expect(results).toEqual([
      { ok: false, label: 'concept not tagged: input-validation' },
      { ok: true, label: 'concept not tagged: async-await' },
    ]);
  });
});

describe('checksReport', () => {
  it('lists each check as a pass or a warning', () => {
    expect(
      checksReport([
        { ok: true, label: 'should say: log' },
        { ok: false, label: 'must not say: fewer calls (found in whyItWorks)' },
      ]),
    ).toEqual([
      '**Checks:** 1/2 passed (warnings, not failures)',
      '',
      '- ✅ should say: log',
      '- ⚠️ must not say: fewer calls (found in whyItWorks)',
    ]);
  });
});

describe('eval check fixtures', () => {
  const dir = join(__dirname, '..', 'fixtures', 'diffs');
  const files = readdirSync(dir).filter((name) => name.endsWith('.checks.json'));

  it('covers the accuracy regressions found in real use', () => {
    expect(files).toEqual(
      expect.arrayContaining(['count-query.checks.json', 'misleading-comment.checks.json']),
    );
  });

  it.each(files)('%s is valid, compiles, and sits next to a one-hunk diff', (name) => {
    const checks = EvalChecksSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    for (const { pattern } of [...checks.mustNotSay, ...checks.shouldSay]) {
      expect(() => new RegExp(pattern, 'i')).not.toThrow();
    }
    const diff = readFileSync(join(dir, name.replace('.checks.json', '.diff')), 'utf8');
    expect(parseUnifiedDiff(diff)).toHaveLength(1);
  });
});
