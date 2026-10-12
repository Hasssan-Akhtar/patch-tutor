import { describe, expect, it } from 'vitest';
import { otherHunksSection } from '../../src/context/otherHunks';
import type { Hunk } from '../../src/git/hunk';

const hunk = (id: string, raw: string): Hunk => ({
  id,
  filePath: 'src/bootstrap.ts',
  status: 'modified',
  newStart: 1,
  newLines: 1,
  oldStart: 1,
  oldLines: 1,
  added: [],
  removed: [],
  raw,
});

const target = hunk('a', '@@ -1 +1 @@\n+count');
const logs = hunk('b', '@@ -20 +20,2 @@\n+log.info("granted")');
const exports = hunk('c', '@@ -40 +41 @@\n+export const LOCALES = [];');

describe('otherHunksSection', () => {
  it('lists the other hunks of the file as a low-priority diff section', () => {
    const section = otherHunksSection(target, [target, logs, exports]);

    expect(section?.title).toMatch(/Other changes in this file.*explain only the change above/);
    expect(section?.language).toBe('diff');
    expect(section?.text).toBe(`${logs.raw}\n${exports.raw}`);
    expect(section?.truncatable).toBe(true);
    // Below the enclosing code (100) and definitions (50 and down), so it is dropped first.
    expect(section?.priority).toBeLessThan(40);
  });

  it('adds nothing when the hunk is alone in its file', () => {
    expect(otherHunksSection(target, [target])).toBeUndefined();
  });

  it('adds nothing when the hunks come from a different diff than the target', () => {
    expect(otherHunksSection(target, [logs, exports])).toBeUndefined();
  });
});
