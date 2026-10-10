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
