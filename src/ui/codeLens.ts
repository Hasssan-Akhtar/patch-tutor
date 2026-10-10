import * as vscode from 'vscode';
import type { HunkService } from '../services/hunkService';
import { hunkRange } from './hunkRange';

/** "Explain this change | Quiz me" above every changed hunk. */
export class HunkCodeLensProvider implements vscode.CodeLensProvider {
  readonly onDidChangeCodeLenses: vscode.Event<void>;

  constructor(private readonly hunks: HunkService) {
    this.onDidChangeCodeLenses = hunks.onDidChange;
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const result = await this.hunks.getHunks(document);
    return (result?.hunks ?? []).flatMap((hunk) => {
      const line = hunkRange(hunk, document).start.line;
      const range = new vscode.Range(line, 0, line, 0);
      return [
        new vscode.CodeLens(range, {
          title: '$(lightbulb) Explain this change',
          command: 'patchTutor.explainHunk',
          arguments: [document.uri, hunk.id],
        }),
        new vscode.CodeLens(range, {
          title: '$(mortar-board) Quiz me',
          command: 'patchTutor.quizHunk',
          arguments: [document.uri, hunk.id],
        }),
      ];
    });
  }
}

export const HUNK_DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file' },
  // The staged side of the diff editor.
  { scheme: 'git' },
];
