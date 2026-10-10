import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from '../../src/git/diffParser';
import { similarity } from '../../src/git/renames';

function fixture(name: string): string {
  return readFileSync(join(__dirname, '../fixtures/diffs', name), 'utf8');
}

describe('parseUnifiedDiff', () => {
  it('splits a modified file into one hunk per @@ block', () => {
    const hunks = parseUnifiedDiff(fixture('modified-multi-hunk.diff'));

    expect(hunks).toHaveLength(2);
    const [first, second] = hunks;
    expect(first).toMatchObject({
      filePath: 'cart.js',
      status: 'modified',
      oldStart: 1,
      oldLines: 7,
      newStart: 1,
      newLines: 8,
      removed: ['export function total(items) {', '    sum += item.price;'],
      added: [
        'export async function total(items) {',
        '  if (items.length === 0) return 0;',
        '    sum += await item.price();',
      ],
    });
    expect(first?.oldPath).toBeUndefined();
    expect(first?.raw.split('\n')[0]).toBe('@@ -1,7 +1,8 @@');
    expect(second).toMatchObject({ newStart: 17, newLines: 5, oldStart: 16, oldLines: 5 });
    expect(second?.added).toEqual(['  return `$${n.toFixed(2)}`;']);
  });

  it('treats a new file as added', () => {
    const [hunk, ...rest] = parseUnifiedDiff(fixture('new-file.diff'));

    expect(rest).toHaveLength(0);
    expect(hunk).toMatchObject({
      filePath: 'newfile.js',
      status: 'added',
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
      added: ['const x = 1;', 'module.exports = x;'],
      removed: [],
    });
  });

  it('uses the old path for a deleted file', () => {
    const [hunk] = parseUnifiedDiff(fixture('deleted-file.diff'));

    expect(hunk).toMatchObject({
      filePath: 'legacy.txt',
      status: 'deleted',
      newStart: 0,
      newLines: 0,
      added: [],
      removed: ['old line 1', 'old line 2'],
    });
  });

  it('records both paths for a rename with changes', () => {
    const [hunk] = parseUnifiedDiff(fixture('rename-with-change.diff'));

    expect(hunk).toMatchObject({
      filePath: 'helpers.py',
      oldPath: 'utils.py',
      status: 'renamed',
      added: ['    return f"hi {name}"'],
      removed: ['    return "hi " + name'],
    });
  });

  it('produces no hunks for a pure rename', () => {
    expect(parseUnifiedDiff(fixture('pure-rename.diff'))).toEqual([]);
  });

  it('skips binary files', () => {
    expect(parseUnifiedDiff(fixture('binary.diff'))).toEqual([]);
  });

  it('keeps the "no newline at end of file" marker in raw but not in added lines', () => {
    const [hunk] = parseUnifiedDiff(fixture('no-newline-at-eof.diff'));

    expect(hunk?.added).toEqual(['c']);
    expect(hunk?.removed).toEqual(['c']);
    expect(hunk?.raw.split('\n').at(-1)).toBe('\\ No newline at end of file');
  });

  it('returns nothing for an empty diff', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
  });

  describe('hunk ids', () => {
    it('are sha1 hex and unique per hunk', () => {
      const ids = parseUnifiedDiff(fixture('modified-multi-hunk.diff')).map((h) => h.id);

      expect(ids.every((id) => /^[0-9a-f]{40}$/.test(id))).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('stay the same when the hunk only moves to other line numbers', () => {
      const diff = fixture('modified-multi-hunk.diff');
      const shifted = diff.replace('@@ -16,5 +17,5 @@', '@@ -40,5 +41,5 @@');

      expect(parseUnifiedDiff(shifted)[1]?.id).toBe(parseUnifiedDiff(diff)[1]?.id);
    });

    it('change with the file path', () => {
      const diff = fixture('new-file.diff');
      const moved = diff.replaceAll('newfile.js', 'other.js');

      expect(parseUnifiedDiff(moved)[0]?.id).not.toBe(parseUnifiedDiff(diff)[0]?.id);
    });
  });
});

describe('rename pairing', () => {
  it('turns a similar deleted + added file pair into one rename hunk', () => {
    const hunks = parseUnifiedDiff(fixture('demo-staged-changes.diff'));

    expect(hunks.map((h) => [h.filePath, h.status])).toEqual([
      ['cart.js', 'modified'],
      ['cart.js', 'modified'],
      ['discount.js', 'added'],
      ['helpers.py', 'renamed'],
      ['notes.txt', 'deleted'],
    ]);
    expect(hunks[3]).toMatchObject({
      oldPath: 'utils.py',
      removed: ['    return "hi " + name'],
      added: ['    return f"hi {name}"'],
    });
  });

  it('drops a rename with identical contents, like git does', () => {
    const diff = [
      'diff --git a/old.js b/old.js',
      'deleted file mode 100644',
      '--- a/old.js',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-const a = 1;',
      '-module.exports = a;',
      'diff --git a/new.js b/new.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.js',
      '@@ -0,0 +1,2 @@',
      '+const a = 1;',
      '+module.exports = a;',
    ].join('\n');

    expect(parseUnifiedDiff(diff)).toEqual([]);
  });

  it('keeps unrelated deleted and added files apart', () => {
    const hunks = parseUnifiedDiff(fixture('demo-staged-changes.diff'));

    expect(hunks.find((h) => h.filePath === 'notes.txt')?.status).toBe('deleted');
    expect(hunks.find((h) => h.filePath === 'discount.js')?.status).toBe('added');
  });
});

describe('similarity', () => {
  it('ranges from 0 to 1', () => {
    expect(similarity('abc', 'abc')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('hello world', 'hello there')).toBeGreaterThan(0.5);
  });
});
