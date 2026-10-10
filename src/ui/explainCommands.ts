import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseUnifiedDiff } from '../git/diffParser';
import { getActiveRepository, getStagedDiff } from '../git/gitService';
import { ProviderError } from '../llm/provider';
import type { ExplainService } from '../services/explainService';

export function registerExplainCommands(
  context: vscode.ExtensionContext,
  service: ExplainService,
  output: vscode.OutputChannel,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('patchTutor.explainStagedChanges', () =>
      explainStagedChanges(service, output),
    ),
  );
}

async function explainStagedChanges(
  service: ExplainService,
  output: vscode.OutputChannel,
): Promise<void> {
  try {
    const repository = await getActiveRepository();
    const hunks = parseUnifiedDiff(await getStagedDiff(repository));
    if (hunks.length === 0) {
      void vscode.window.showInformationMessage('Patch Tutor: No staged changes to explain.');
      return;
    }

    output.clear();
    output.appendLine(
      `Explaining ${hunks.length} staged hunk(s) in ${path.basename(repository.rootUri.fsPath)}`,
    );
    output.show(true);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Patch Tutor',
        cancellable: true,
      },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());

        for (const [index, hunk] of hunks.entries()) {
          if (controller.signal.aborted) {
            break;
          }
          progress.report({
            message: `Explaining ${index + 1}/${hunks.length}: ${hunk.filePath}`,
            increment: 100 / hunks.length,
          });
          const result = await service.explainHunk(hunk, 'standard', {
            signal: controller.signal,
            repoRoot: repository.rootUri.fsPath,
          });
          const where =
            hunk.status === 'deleted'
              ? 'deleted file'
              : `lines ${hunk.newStart}-${hunk.newStart + Math.max(hunk.newLines, 1) - 1}`;
          const file = hunk.oldPath ? `${hunk.oldPath} -> ${hunk.filePath}` : hunk.filePath;
          output.appendLine(`\n── ${file} (${where})`);
          if (result.kind === 'explanation') {
            output.appendLine(result.fromCache ? '(from cache)' : '(validated)');
            output.appendLine(JSON.stringify(result.explanation, null, 2));
          } else {
            output.appendLine(`(schema validation failed: ${result.error})`);
            output.appendLine(result.text);
          }
        }
      },
    );
  } catch (error) {
    if (error instanceof ProviderError && error.kind === 'cancelled') {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Patch Tutor: ${message}`);
  }
}
