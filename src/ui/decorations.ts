import * as vscode from 'vscode';
import type { HunkService } from '../services/hunkService';
import { hunkRange } from './hunkRange';

/** A lightbulb in the gutter on the first changed line of every hunk in visible editors. */
export class GutterDecorations implements vscode.Disposable {
  private readonly type: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    extensionUri: vscode.Uri,
    private readonly hunks: HunkService,
  ) {
    this.type = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(extensionUri, 'media', 'lightbulb.svg'),
      gutterIconSize: 'contain',
    });
    this.disposables.push(
      this.type,
      hunks.onDidChange(() => this.refresh()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('patchTutor.gutterIcons')) {
          this.refresh();
        }
      }),
    );
    this.refresh();
  }

  refresh(): void {
    const enabled = vscode.workspace.getConfiguration('patchTutor').get('gutterIcons', true);
    for (const editor of vscode.window.visibleTextEditors) {
      void this.decorate(editor, enabled);
    }
  }

  private async decorate(editor: vscode.TextEditor, enabled: boolean): Promise<void> {
    const result = enabled ? await this.hunks.getHunks(editor.document) : undefined;
    const ranges = (result?.hunks ?? []).map((hunk) => {
      const line = hunkRange(hunk, editor.document).start.line;
      return new vscode.Range(line, 0, line, 0);
    });
    editor.setDecorations(this.type, ranges);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
