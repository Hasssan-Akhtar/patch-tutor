import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseUnifiedDiff } from './git/diffParser';
import { getActiveRepository, getStagedDiff } from './git/gitService';
import type { Hunk } from './git/hunk';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Patch Tutor');

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
