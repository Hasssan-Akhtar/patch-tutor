import { createTwoFilesPatch, diffChars, diffLines } from 'diff';
import type { Hunk } from './hunk';

/** Same default as git's rename detection (-M50%). */
const SIMILARITY_THRESHOLD = 0.5;
/** Above this many characters, compare by lines; character diffs get slow. */
const CHAR_DIFF_LIMIT = 20_000;

/**
 * VS Code's git API returns diffs without rename detection, so a renamed file
 * arrives as a deleted file plus an added file. This pairs them back up when
 * their contents are similar enough and replaces both with real rename hunks
 * (or with nothing, for a rename without edits).
 */
export function pairRenames(hunks: Hunk[], parse: (diff: string) => Hunk[]): Hunk[] {
  const deleted = wholeFiles(hunks, 'deleted', (h) => h.removed);
  const added = wholeFiles(hunks, 'added', (h) => h.added);
  if (deleted.size === 0 || added.size === 0) {
    return hunks;
  }

  const candidates: { from: string; to: string; score: number }[] = [];
  for (const [from, oldText] of deleted) {
    for (const [to, newText] of added) {
      const score = similarity(oldText, newText);
      if (score >= SIMILARITY_THRESHOLD) {
        candidates.push({ from, to, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const replaced = new Set<string>();
  const renameHunks = new Map<string, Hunk[]>();
  for (const { from, to } of candidates) {
    if (replaced.has(from) || replaced.has(to)) {
      continue;
    }
    replaced.add(from);
    replaced.add(to);
    const patch = createTwoFilesPatch(
      `a/${from}`,
      `b/${to}`,
      deleted.get(from) ?? '',
      added.get(to) ?? '',
      undefined,
      undefined,
      { context: 3 },
    );
    renameHunks.set(to, parse(patch));
  }

  // Rename hunks take the added file's place so the order still follows the diff.
  return hunks.flatMap((hunk) => {
    if (!replaced.has(hunk.filePath)) {
      return [hunk];
    }
    const renamed = renameHunks.get(hunk.filePath);
    renameHunks.delete(hunk.filePath);
    return renamed ?? [];
  });
}

/** Full file contents for files that were added or deleted as a whole. */
function wholeFiles(
  hunks: Hunk[],
  status: 'added' | 'deleted',
  lines: (hunk: Hunk) => string[],
): Map<string, string> {
  const files = new Map<string, string>();
  for (const hunk of hunks) {
    if (hunk.status === status) {
      files.set(hunk.filePath, (files.get(hunk.filePath) ?? '') + lines(hunk).join('\n') + '\n');
    }
  }
  return files;
}

/** Share of content two texts have in common, from 0 (nothing) to 1 (identical). */
export function similarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const total = a.length + b.length;
  if (total === 0) {
    return 1;
  }
  const changes = total <= CHAR_DIFF_LIMIT ? diffChars(a, b) : diffLines(a, b);
  const common = changes
    .filter((c) => !c.added && !c.removed)
    .reduce((n, c) => n + c.value.length, 0);
  return (2 * common) / total;
}
