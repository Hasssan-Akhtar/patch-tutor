import type { Hunk } from '../git/hunk';
import type { ContextSection } from './budget';

export const OTHER_HUNKS_TITLE =
  'Other changes in this file (for context only; explain only the change above)';

/** Below definitions, so it is the first section dropped when the budget is tight. */
const PRIORITY = 10;

/**
 * The file's other changed hunks, so an explanation knows about related edits
 * (new logs, exports, a second function) without describing them as its own.
 * `fileHunks` must come from the same diff as `hunk`, or nothing is added.
 */
export function otherHunksSection(
  hunk: Hunk,
  fileHunks: readonly Hunk[],
): ContextSection | undefined {
  if (!fileHunks.some((h) => h.id === hunk.id)) {
    return undefined;
  }
  const others = fileHunks.filter((h) => h.id !== hunk.id);
  if (others.length === 0) {
    return undefined;
  }
  return {
    title: OTHER_HUNKS_TITLE,
    text: others.map((h) => h.raw).join('\n'),
    priority: PRIORITY,
    truncatable: true,
    language: 'diff',
  };
}
