import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addedLines, extractIdentifiers } from '../../src/context/hunkLines';
import { parseUnifiedDiff } from '../../src/git/diffParser';

const hunks = parseUnifiedDiff(
  readFileSync(join(__dirname, '../fixtures/diffs/modified-multi-hunk.diff'), 'utf8'),
);

function hunkAt(index: number) {
  const hunk = hunks[index];
  if (!hunk) {
    throw new Error(`fixture has no hunk ${index}`);
  }
  return hunk;
}

describe('addedLines', () => {
  it('numbers added lines in the new file, skipping removed ones', () => {
    expect(addedLines(hunkAt(0))).toEqual([
      { line: 1, text: 'export async function total(items) {' },
      { line: 2, text: '  if (items.length === 0) return 0;' },
      { line: 5, text: '    sum += await item.price();' },
    ]);
  });

  it('starts from the hunk new start', () => {
    expect(addedLines(hunkAt(1))).toEqual([{ line: 20, text: '  return `$${n.toFixed(2)}`;' }]);
  });
});

describe('extractIdentifiers', () => {
  it('returns each identifier once with its position, skipping keywords', () => {
    expect(extractIdentifiers(addedLines(hunkAt(0)))).toEqual([
      { name: 'total', line: 1, column: 22 },
      { name: 'items', line: 1, column: 28 },
      { name: 'length', line: 2, column: 12 },
      { name: 'sum', line: 5, column: 4 },
      { name: 'item', line: 5, column: 17 },
      { name: 'price', line: 5, column: 22 },
    ]);
  });

  it('ignores words inside strings and comments', () => {
    const ids = extractIdentifiers([
      { line: 1, text: 'log("hello world", count) // trailing note' },
    ]).map((i) => i.name);

    expect(ids).toEqual(['log', 'count']);
  });
});
