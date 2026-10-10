import * as vscode from 'vscode';
import { languageFromPath } from '../context/language';
import { parseUnifiedDiff } from '../git/diffParser';
import type { Hunk } from '../git/hunk';
import type { Depth } from '../llm/schemas';
import {
  EXPLAIN_PROMPT_VERSION,
  type ExplainResult,
  type ExplainService,
  type HunkContext,
} from '../services/explainService';

/**
 * Development-only: runs every fixture diff through the explain prompt with
 * the configured provider and writes a Markdown report for side-by-side
 * review after a prompt change. Fixtures have no repository, so explanations
 * see only the diff.
 */
export async function runPromptEvals(
  extensionUri: vscode.Uri,
  service: ExplainService,
  modelKey: string,
): Promise<void> {
  const depths = await pickDepths();
  if (!depths) {
    return;
  }

  const fixturesDir = vscode.Uri.joinPath(extensionUri, 'test', 'fixtures', 'diffs');
  const fixtures = (await vscode.workspace.fs.readDirectory(fixturesDir))
    .map(([name]) => name)
    .filter((name) => name.endsWith('.diff'))
    .sort();

  const report: string[] = [
    '# Explain prompt eval',
    '',
    `- Prompt version: \`${EXPLAIN_PROMPT_VERSION}\``,
    `- Model: \`${modelKey}\``,
    `- Depths: ${depths.join(', ')}`,
    `- Run at: ${new Date().toISOString()}`,
  ];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Prompt evals', cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());

      for (const name of fixtures) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(fixturesDir, name));
        const hunks = parseUnifiedDiff(new TextDecoder().decode(bytes));
        report.push('', `## ${name}`);
        if (hunks.length === 0) {
          report.push('', '_No text hunks (binary file or pure rename)._');
        }
        for (const hunk of hunks) {
          for (const depth of depths) {
            if (controller.signal.aborted) {
              return;
            }
            progress.report({ message: `${name}: ${hunk.filePath} (${depth})` });
            const result = await service.explainHunk(hunk, depth, controller.signal, {
              skipCache: true,
            });
            report.push('', ...formatResult(hunk, depth, result));
          }
        }
      }
    },
  );

  const outDir = vscode.Uri.joinPath(extensionUri, 'evals', 'output');
  await vscode.workspace.fs.createDirectory(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = vscode.Uri.joinPath(outDir, `explain-${EXPLAIN_PROMPT_VERSION}-${stamp}.md`);
  await vscode.workspace.fs.writeFile(outFile, new TextEncoder().encode(report.join('\n') + '\n'));
  await vscode.window.showTextDocument(outFile, { preview: false });
}

/** Context for fixtures: there is no repository, so only the diff is available. */
export async function fixtureContext(hunk: Hunk): Promise<HunkContext> {
  return {
    languageId: languageFromPath(hunk.filePath),
    frameworks: [],
    sections: [],
    dropped: [],
    diff: hunk.raw,
  };
}

async function pickDepths(): Promise<Depth[] | undefined> {
  const items = (['simple', 'standard', 'deep'] as const).map((depth) => ({
    label: depth,
    picked: depth === 'standard',
  }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Prompt evals: depths to run',
    canPickMany: true,
  });
  return picked && picked.length > 0 ? picked.map((p) => p.label) : undefined;
}

function formatResult(hunk: Hunk, depth: Depth, result: ExplainResult): string[] {
  const file = hunk.oldPath ? `${hunk.oldPath} → ${hunk.filePath}` : hunk.filePath;
  const out = [`### ${file} · ${hunk.status} · ${depth}`, '', '```diff', hunk.raw, '```', ''];
  if (result.kind === 'raw') {
    return [...out, `**Schema validation failed:** ${result.error}`, '', '```', result.text, '```'];
  }
  const e = result.explanation;
  return [
    ...out,
    `**Summary:** ${e.summary}`,
    '',
    `**What changed:** ${e.whatChanged}`,
    '',
    `**How it works:** ${e.howItWorks}`,
    '',
    `**Why it works:** ${e.whyItWorks}`,
    '',
    `**Concepts:** ${e.concepts.join(', ') || '_none_'}`,
    '',
    '**Risks:**',
    ...(e.risks.length > 0 ? e.risks.map((r) => `- ${r}`) : ['- _none_']),
  ];
}
