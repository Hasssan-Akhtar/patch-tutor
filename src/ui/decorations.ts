import * as vscode from 'vscode';
import type { HunkService } from '../services/hunkService';
import { hunkRange } from './hunkRange';

/**
 * Marks explainable hunks in visible editors: a lightbulb in the gutter on the
 * first changed line, a soft highlight on the changed lines, and a marker in
 * the scrollbar so changes are easy to find in long files.
 */
export class HunkDecorations implements vscode.Disposable {
  private readonly gutter: vscode.TextEditorDecorationType;
  private readonly highlight = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    backgroundColor: new vscode.ThemeColor('patchTutor.changedLineBackground'),
    overviewRulerColor: new vscode.ThemeColor('patchTutor.changedLineRuler'),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
  });
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    private readonly hunks: HunkService,
  ) {
    this.gutter = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'lightbulb.svg'),
      gutterIconSize: 'contain',
    });
    this.disposables.push(
      this.gutter,
      this.highlight,
      hunks.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('patchTutor.gutterIcons') ||
          e.affectsConfiguration('patchTutor.highlightChangedLines')
        ) {
          this.refresh();
        }
      }),
    );
    this.refresh();
  }

  refresh(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      void this.decorate(editor);
    }
  }

  private async decorate(editor: vscode.TextEditor): Promise<void> {
    const config = vscode.workspace.getConfiguration('patchTutor');
    const result = await this.hunks.getHunks(editor.document);
    const ranges = (result?.hunks ?? []).map((hunk) => hunkRange(hunk, editor.document));
    editor.setDecorations(
      this.gutter,
      config.get('gutterIcons', true) ? ranges.map((r) => new vscode.Range(r.start, r.start)) : [],
    );
    editor.setDecorations(this.highlight, config.get('highlightChangedLines', true) ? ranges : []);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
