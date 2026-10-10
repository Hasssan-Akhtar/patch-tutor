import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ConceptStore, HunkRef } from '../../learning/conceptStore';
import { progressStats } from '../../learning/stats';
import { dashboardHtml, RECENT_ACTIVITY, type DashboardModel } from './dashboardHtml';

export const DASHBOARD_VIEW_ID = 'patchTutor.progress';

interface DashboardMessage {
  action?: unknown;
  filePath?: unknown;
  line?: unknown;
}

/** The Progress page in the Patch Tutor sidebar: stats, concepts and recent answers. */
export class DashboardView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscription: { dispose(): void };

  constructor(private readonly store: ConceptStore) {
    this.subscription = store.onDidChange(() => void this.refresh());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // Scripts only drive clicks, bar widths and remembering open sections.
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.onDidReceiveMessage((message: DashboardMessage) => void this.handle(message));
    // Relative times ("5m ago") go stale, so re-render whenever the view is shown again.
    view.onDidChangeVisibility(() => {
      if (view.visible) {
        void this.refresh();
      }
    });
    view.onDidDispose(() => {
      this.view = undefined;
    });
    void this.refresh();
  }

  async model(): Promise<DashboardModel> {
    const now = Date.now();
    const [concepts, activity, inputs] = await Promise.all([
      this.store.summaries(),
      this.store.activity(),
      this.store.progressInputs(),
    ]);
    const hunks: Record<string, HunkRef> = {};
    for (const entry of activity.slice(0, RECENT_ACTIVITY)) {
      const ref = hunks[entry.hunkId] ?? (await this.store.findHunk(entry.hunkId));
      if (ref) {
        hunks[entry.hunkId] = ref;
      }
    }
    return { stats: progressStats(inputs, now), concepts, activity, hunks, now };
  }

  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    this.view.webview.html = dashboardHtml(await this.model(), {
      nonce: randomBytes(16).toString('base64'),
      cspSource: this.view.webview.cspSource,
    });
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private async handle(message: DashboardMessage): Promise<void> {
    if (message.action === 'openFile' && typeof message.filePath === 'string') {
      await openWorkspaceFile(
        message.filePath,
        typeof message.line === 'number' ? message.line : 1,
      );
    } else if (message.action === 'reset') {
      await vscode.commands.executeCommand('patchTutor.resetProgress');
    }
  }
}

/**
 * Opens a repo-relative path from any workspace folder at a 1-based line.
 * Returns false (and says so) when no folder has it, e.g. after a rename.
 */
export async function openWorkspaceFile(filePath: string, line: number): Promise<boolean> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(folder.uri, filePath);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      continue;
    }
    const editor = await vscode.window.showTextDocument(uri, { preview: true });
    const position = new vscode.Position(Math.max(line - 1, 0), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    return true;
  }
  void vscode.window.showInformationMessage(
    `Patch Tutor: ${filePath} is not in this workspace any more. The change is still shown in Progress.`,
  );
  return false;
}
