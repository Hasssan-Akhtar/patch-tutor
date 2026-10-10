import { createHash } from 'node:crypto';
import parseDiff from 'parse-diff';
import type { FileStatus, Hunk } from './hunk';
import { pairRenames } from './renames';

const DEV_NULL = '/dev/null';
// git writes this marker after a line with no trailing newline.
const NO_NEWLINE_MARKER = '\\ No newline at end of file';

/**
 * Turns a unified diff into hunks. Binary files, mode-only changes and pure
 * renames have no text hunks, so they produce nothing. A deleted file and an
 * added file with similar contents are treated as a rename.
 */
export function parseUnifiedDiff(diff: string): Hunk[] {
  return pairRenames(parseFiles(diff), parseFiles);
}

function parseFiles(diff: string): Hunk[] {
  const hunks: Hunk[] = [];

  for (const file of parseDiff(diff)) {
    const from = file.from && file.from !== DEV_NULL ? file.from : undefined;
    const to = file.to && file.to !== DEV_NULL ? file.to : undefined;
    const filePath = to ?? from;
    if (!filePath) {
      continue;
    }
    const status = fileStatus(from, to);

    for (const chunk of file.chunks) {
      // The marker stays in the raw diff (it can be the whole change) but is not a line of code.
      const body = chunk.changes.map((change) => change.content);
      const lines = chunk.changes.filter((change) => change.content !== NO_NEWLINE_MARKER);
      const added = lines.filter((c) => c.type === 'add').map((c) => c.content.slice(1));
      const removed = lines.filter((c) => c.type === 'del').map((c) => c.content.slice(1));

      hunks.push({
        // Hashing the body (not the @@ header) keeps the id stable when edits
        // elsewhere in the file shift this hunk's line numbers.
        id: hunkId(filePath, body),
        filePath,
        ...(status === 'renamed' ? { oldPath: from } : {}),
        status,
        newStart: chunk.newStart,
        newLines: chunk.newLines,
        oldStart: chunk.oldStart,
        oldLines: chunk.oldLines,
        added,
        removed,
        raw: [chunk.content, ...body].join('\n'),
      });
    }
  }

  return hunks;
}

function fileStatus(from: string | undefined, to: string | undefined): FileStatus {
  if (!from) {
    return 'added';
  }
  if (!to) {
    return 'deleted';
  }
  return from === to ? 'modified' : 'renamed';
}

function hunkId(filePath: string, body: string[]): string {
  return createHash('sha1').update(filePath).update('\0').update(body.join('\n')).digest('hex');
}
