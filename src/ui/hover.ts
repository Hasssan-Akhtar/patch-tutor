import * as vscode from 'vscode';
import type { HunkService } from '../services/hunkService';
import { hunkRange } from './hunkRange';

const COMMANDS = ['patchTutor.explainHunk', 'patchTutor.quizHunk'];

/** Hovering a changed line offers the same actions as the CodeLens, as clickable buttons. */
export class HunkHoverProvider implements vscode.HoverProvider {
  constructor(private readonly hunks: HunkService) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    const result = await this.hunks.getHunks(document);
    for (const hunk of result?.hunks ?? []) {
      const range = hunkRange(hunk, document);
      if (range.contains(position)) {
        const args = encodeURIComponent(JSON.stringify([document.uri.toString(), hunk.id]));
        const md = new vscode.MarkdownString(
          `**Patch Tutor** · ` +
            `[$(lightbulb) Explain this change](command:patchTutor.explainHunk?${args}) · ` +
            `[$(mortar-board) Quiz me](command:patchTutor.quizHunk?${args})`,
          true,
        );
        // Only these two commands may run from the hover.
        md.isTrusted = { enabledCommands: COMMANDS };
        return new vscode.Hover(md, range);
      }
    }
    return undefined;
  }
}
