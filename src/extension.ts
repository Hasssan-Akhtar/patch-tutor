import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExplanationCache } from './cache/explanationCache';
import { buildHunkContext } from './context/contextBuilder';
import { fixtureContext, runPromptEvals } from './dev/promptEvals';
import { parseUnifiedDiff } from './git/diffParser';
import { getActiveRepository, getStagedDiff } from './git/gitService';
import type { Hunk } from './git/hunk';
import { ExplainService } from './services/explainService';
import { createProvider, getModelKey } from './services/providerService';
import { registerExplainCommands } from './ui/explainCommands';
import { registerProviderCommands } from './ui/providerCommands';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Patch Tutor');
  registerProviderCommands(context);

  const config = () => vscode.workspace.getConfiguration('patchTutor');
  const explainService = new ExplainService({
    createProvider,
    modelKey: getModelKey,
    buildContext: async (hunk, signal) =>
      buildHunkContext(
        hunk,
        (await getActiveRepository()).rootUri,
        config().get<number>('contextTokenBudget', 6000),
        signal,
      ),
    cache: new ExplanationCache(
      vscode.Uri.joinPath(context.globalStorageUri, 'explanations.json').fsPath,
    ),
    maxOutputTokens: () => config().get<number>('maxOutputTokens', 1200),
  });
  registerExplainCommands(context, explainService, output);

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    const evalService = new ExplainService({
      createProvider,
      modelKey: getModelKey,
      buildContext: fixtureContext,
      cache: new ExplanationCache(
        vscode.Uri.joinPath(context.globalStorageUri, 'eval-cache.json').fsPath,
      ),
      maxOutputTokens: () => config().get<number>('maxOutputTokens', 1200),
    });
    void vscode.commands.executeCommand('setContext', 'patchTutor.devMode', true);
    context.subscriptions.push(
      vscode.commands.registerCommand('patchTutor.dev.runPromptEvals', () =>
        runPromptEvals(context.extensionUri, evalService, getModelKey()),
      ),
    );
  }

  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('patchTutor.listStagedHunks', async () => {
      try {
        const repository = await getActiveRepository();
        const hunks = parseUnifiedDiff(await getStagedDiff(repository));
        output.clear();
        output.appendLine(
          `${hunks.length} staged hunk(s) in ${path.basename(repository.rootUri.fsPath)}`,
        );
        for (const hunk of hunks) {
          output.appendLine(formatHunk(hunk));
        }
        output.show(true);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Patch Tutor: ${message}`);
      }
    }),
  );
}

export function deactivate(): void {}

function formatHunk(hunk: Hunk): string {
  const file = hunk.oldPath ? `${hunk.oldPath} -> ${hunk.filePath}` : hunk.filePath;
  const end = hunk.newStart + Math.max(hunk.newLines, 1) - 1;
  return `\n${file} [${hunk.status}] lines ${hunk.newStart}-${end} (+${hunk.added.length} -${hunk.removed.length})\n${hunk.raw}`;
}
