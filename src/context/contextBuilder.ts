import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import type { HunkContext } from '../services/explainService';
import { fitToBudget, truncateLines, type ContextSection } from './budget';
import { detectFrameworks } from './frameworks';
import { addedLines, extractIdentifiers } from './hunkLines';
import { languageFromPath } from './language';
import { estimateTokens } from './tokens';

const MAX_DEFINITIONS = 5;
const MAX_DEFINITION_LINES = 40;
/** Caps language-server round trips for very large hunks. */
const MAX_IDENTIFIER_LOOKUPS = 25;

const ENCLOSING_KINDS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Enum,
  vscode.SymbolKind.Module,
  vscode.SymbolKind.Namespace,
]);

interface FoundRange {
  uri: vscode.Uri;
  range: vscode.Range;
}

/**
 * Gathers what a reader needs to understand a hunk: the enclosing symbol,
 * definitions of symbols used in added lines, language and frameworks. Uses
 * whatever language servers are installed, so it degrades gracefully to just
 * the diff when none are.
 */
export async function buildHunkContext(
  hunk: Hunk,
  repoRoot: vscode.Uri,
  tokenBudget: number,
  signal?: AbortSignal,
): Promise<HunkContext> {
  const uri = vscode.Uri.joinPath(repoRoot, hunk.filePath);
  const document = hunk.status === 'deleted' ? undefined : await openDocument(uri);
  const languageId = document?.languageId ?? languageFromPath(hunk.filePath);
  const frameworks = detectFrameworks(await readManifests(repoRoot));

  const diffBudget = Math.floor(tokenBudget / 2);
  const diff =
    estimateTokens(hunk.raw) <= diffBudget
      ? hunk.raw
      : (truncateLines(hunk.raw, diffBudget) ?? hunk.raw.slice(0, diffBudget * 4));

  const sections: ContextSection[] = [];
  const hunkRange = new vscode.Range(
    Math.max(hunk.newStart - 1, 0),
    0,
    Math.max(hunk.newStart + hunk.newLines - 2, 0),
    0,
  );

  let enclosing: vscode.Range | undefined;
  // For a new file the whole file is already in the diff.
  if (document && hunk.status !== 'added') {
    enclosing = await findEnclosingSymbol(uri, hunkRange);
    if (enclosing) {
      sections.push({
        title: `Enclosing code (lines ${enclosing.start.line + 1}-${enclosing.end.line + 1})`,
        text: document.getText(enclosing),
        priority: 100,
        truncatable: true,
      });
    }
  }

  if (document) {
    const definitions = await findDefinitions(hunk, uri, repoRoot, [hunkRange, enclosing], signal);
    definitions.forEach((d, i) => sections.push({ ...d, priority: 50 - i }));
  }

  const remaining = tokenBudget - estimateTokens(diff);
  const fitted = fitToBudget(sections, Math.max(remaining, 0));
  return { languageId, frameworks, sections: fitted.kept, dropped: fitted.dropped, diff };
}

async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

async function findEnclosingSymbol(
  uri: vscode.Uri,
  target: vscode.Range,
): Promise<vscode.Range | undefined> {
  const symbols = await vscode.commands.executeCommand<
    (vscode.DocumentSymbol | vscode.SymbolInformation)[] | undefined
  >('vscode.executeDocumentSymbolProvider', uri);

  let best: vscode.Range | undefined;
  const visit = (symbol: vscode.DocumentSymbol | vscode.SymbolInformation) => {
    const range = 'location' in symbol ? symbol.location.range : symbol.range;
    if (!range.contains(target.start)) {
      return;
    }
    // Children are narrower, so the last match is the innermost enclosing symbol.
    if (ENCLOSING_KINDS.has(symbol.kind)) {
      best = range;
    }
    if ('children' in symbol) {
      symbol.children.forEach(visit);
    }
  };
  (symbols ?? []).forEach(visit);
  return best;
}

async function findDefinitions(
  hunk: Hunk,
  uri: vscode.Uri,
  repoRoot: vscode.Uri,
  alreadyShown: (vscode.Range | undefined)[],
  signal?: AbortSignal,
): Promise<Omit<ContextSection, 'priority'>[]> {
  const results: Omit<ContextSection, 'priority'>[] = [];
  const seen = new Set<string>();
  const identifiers = extractIdentifiers(addedLines(hunk)).slice(0, MAX_IDENTIFIER_LOOKUPS);

  for (const identifier of identifiers) {
    if (results.length >= MAX_DEFINITIONS || signal?.aborted) {
      break;
    }
    const position = new vscode.Position(identifier.line - 1, identifier.column);
    const found = await vscode.commands.executeCommand<
      (vscode.Location | vscode.LocationLink)[] | undefined
    >('vscode.executeDefinitionProvider', uri, position);
    const target = found?.map(toFoundRange)[0];
    if (!target || !isInside(target.uri, repoRoot) || target.uri.path.includes('/node_modules/')) {
      continue;
    }
    const sameFile = target.uri.toString() === uri.toString();
    if (sameFile && alreadyShown.some((r) => r?.contains(target.range.start))) {
      continue;
    }
    const key = `${target.uri.toString()}:${target.range.start.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const document = await openDocument(target.uri);
    if (!document) {
      continue;
    }
    const start = target.range.start.line;
    const end = Math.min(
      Math.max(target.range.end.line, start),
      start + MAX_DEFINITION_LINES - 1,
      document.lineCount - 1,
    );
    const relative = vscode.workspace.asRelativePath(target.uri, false);
    results.push({
      title: `Definition of \`${identifier.name}\` (${relative}:${start + 1})`,
      text: document.getText(new vscode.Range(start, 0, end, Number.MAX_SAFE_INTEGER)),
    });
  }
  return results;
}

function toFoundRange(location: vscode.Location | vscode.LocationLink): FoundRange {
  return 'targetUri' in location
    ? { uri: location.targetUri, range: location.targetRange }
    : { uri: location.uri, range: location.range };
}

function isInside(uri: vscode.Uri, root: vscode.Uri): boolean {
  const rootPath = root.path.endsWith('/') ? root.path : `${root.path}/`;
  return uri.scheme === root.scheme && uri.path.startsWith(rootPath);
}

async function readManifests(repoRoot: vscode.Uri) {
  const read = async (name: string) => {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(repoRoot, name));
      return new TextDecoder().decode(bytes);
    } catch {
      return undefined;
    }
  };
  const [packageJson, requirementsTxt, pyprojectToml, goMod] = await Promise.all([
    read('package.json'),
    read('requirements.txt'),
    read('pyproject.toml'),
    read('go.mod'),
  ]);
  return { packageJson, requirementsTxt, pyprojectToml, goMod };
}
