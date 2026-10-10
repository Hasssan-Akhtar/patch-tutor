import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ConceptStore, HunkRef } from '../../learning/conceptStore';
import { progressStats } from '../../learning/stats';
import { dashboardHtml, type DashboardModel } from './dashboardHtml';

export const DASHBOARD_VIEW_ID = 'patchTutor.progress';

interface DashboardMessage {
  action?: unknown;
  hunkId?: unknown;
}

/** The Progress page in the Patch Tutor sidebar: stats, concepts to practise and recent answers. */
export class DashboardView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subscription: { dispose(): void };

  constructor(private readonly store: ConceptStore) {
    this.subscription = store.onDidChange(() => void this.refresh());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    // Scripts only drive clicks and bar widths; no local or remote resources are loaded.
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
    return { stats: progressStats(inputs, now), concepts, activity, now };
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
    if (message.action === 'openHunk' && typeof message.hunkId === 'string') {
      const ref = await this.store.findHunk(message.hunkId);
      if (ref) {
        await showSavedHunk(ref);
      }
    } else if (message.action === 'reset') {
      await vscode.commands.executeCommand('patchTutor.resetProgress');
    }
  }
}

/** Opens a change as it was when quizzed, so it still works after commits or edits. */
export async function showSavedHunk(ref: HunkRef): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    content: `# ${ref.filePath} (line ${ref.line})\n${ref.diff}\n`,
    language: 'diff',
  });
  await vscode.window.showTextDocument(document, { preview: true });
}
