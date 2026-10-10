import type { Hunk } from '../git/hunk';

export interface NumberedLine {
  /** 1-based line number in the new version of the file. */
  line: number;
  text: string;
}

export interface Identifier {
  name: string;
  line: number;
  /** 0-based column of the identifier's first character. */
  column: number;
}

/** Added lines of a hunk with their line numbers in the new file. */
export function addedLines(hunk: Hunk): NumberedLine[] {
  const result: NumberedLine[] = [];
  let line = hunk.newStart;
  for (const raw of hunk.raw.split('\n').slice(1)) {
    if (raw.startsWith('+')) {
      result.push({ line, text: raw.slice(1) });
      line++;
    } else if (raw.startsWith(' ')) {
      line++;
    }
  }
  return result;
}

// Keywords common to the languages we expect; skipping them saves definition lookups.
const KEYWORDS = new Set(
  (
    'if else for while do return function const let var class new this self super import from ' +
    'export default async await try catch finally throw typeof instanceof in of true false null ' +
    'undefined void break continue switch case yield static public private protected readonly ' +
    'interface type enum extends implements def lambda pass elif not and or is None True False ' +
    'with as raise except global nonlocal func go defer chan map struct package range nil fn mut ' +
    'pub impl trait use mod match where loop'
  ).split(' '),
);

/**
 * Identifiers used on the given lines, first occurrence of each name only.
 * String literals and comments are blanked first so their words are ignored.
 */
export function extractIdentifiers(lines: NumberedLine[]): Identifier[] {
  const seen = new Set<string>();
  const result: Identifier[] = [];
  for (const { line, text } of lines) {
    const code = blankStringsAndComments(text);
    for (const match of code.matchAll(/[A-Za-z_$][\w$]*/g)) {
      const name = match[0];
      if (name.length < 2 || KEYWORDS.has(name) || seen.has(name)) {
        continue;
      }
      seen.add(name);
      result.push({ name, line, column: match.index });
    }
  }
  return result;
}

function blankStringsAndComments(text: string): string {
  return text
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, (s) => ' '.repeat(s.length))
    .replace(/(\/\/|#).*$/, (s) => ' '.repeat(s.length));
}

/**
 * First and last lines (1-based, new file) that the hunk actually changes,
 * ignoring context lines. A pure deletion maps to the line where text was removed.
 */
export function changedLineRange(hunk: Hunk): { start: number; end: number } {
  let line = hunk.newStart;
  let start: number | undefined;
  let end: number | undefined;
  const mark = (at: number) => {
    start ??= at;
    end = at;
  };
  for (const raw of hunk.raw.split('\n').slice(1)) {
    if (raw.startsWith('+')) {
      mark(line);
      line++;
    } else if (raw.startsWith('-')) {
      // Removed text sat just before the current new-file line.
      mark(Math.max(line, 1));
    } else if (raw.startsWith(' ')) {
      line++;
    }
  }
  const fallback = Math.max(hunk.newStart, 1);
  return { start: start ?? fallback, end: Math.max(end ?? fallback, start ?? fallback) };
}
