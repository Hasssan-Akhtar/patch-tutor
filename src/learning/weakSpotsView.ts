import * as vscode from 'vscode';
import type { ConceptStore, ConceptSummary, HunkRef } from './conceptStore';
import { masteryLevel, type MasteryLevel } from './concepts';

const LEVEL_COLOR: Record<MasteryLevel, string> = {
  weak: 'charts.red',
  shaky: 'charts.yellow',
  solid: 'charts.green',
};

const LEVEL_LABEL: Record<MasteryLevel, string> = {
  weak: 'needs practice',
  shaky: 'getting there',
  solid: 'solid',
};

type Node = { kind: 'concept'; concept: ConceptSummary } | { kind: 'hunk'; ref: HunkRef };

/** Sidebar list of concepts from quizzes, weakest first; expand one to see the changes it came from. */
export class WeakSpotsProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly subscription: { dispose(): void };
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly store: ConceptStore) {
    this.subscription = store.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changed.fire();
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (!node) {
      return (await this.store.summaries()).map((concept) => ({ kind: 'concept', concept }));
    }
    return node.kind === 'concept' ? node.concept.hunks.map((ref) => ({ kind: 'hunk', ref })) : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return node.kind === 'concept' ? conceptItem(node.concept) : hunkItem(node.ref);
  }

  dispose(): void {
    this.subscription.dispose();
    this.changed.dispose();
  }
}

function conceptItem(concept: ConceptSummary): vscode.TreeItem {
  const level = masteryLevel(concept.score);
  const percent = Math.round(concept.score * 100);
  const item = new vscode.TreeItem(concept.name, vscode.TreeItemCollapsibleState.Collapsed);
  item.description = `${percent}% · ${concept.attempts} ${concept.attempts === 1 ? 'try' : 'tries'}`;
  item.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(LEVEL_COLOR[level]));
  item.tooltip = new vscode.MarkdownString(
    `**${concept.name}**: ${LEVEL_LABEL[level]} (${percent}%)\n\n` +
      `${concept.correct} of ${concept.attempts} answers fully correct. ` +
      `Recent answers count most.\n\nLast practised ${new Date(concept.lastSeen).toLocaleDateString()}.`,
  );
  item.contextValue = 'patchTutorConcept';
  return item;
}

function hunkItem(ref: HunkRef): vscode.TreeItem {
  const item = new vscode.TreeItem(ref.filePath, vscode.TreeItemCollapsibleState.None);
  item.description = `line ${ref.line} · ${new Date(ref.lastSeen).toLocaleDateString()}`;
  item.iconPath = new vscode.ThemeIcon('diff');
  item.tooltip = 'Show the change this concept was quizzed on';
  item.command = { command: 'patchTutor.showConceptHunk', title: 'Show change', arguments: [ref] };
  return item;
}

/** Opens the change as it was when quizzed, so it still works after commits or edits. */
export async function showConceptHunk(ref: HunkRef): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    content: `# ${ref.filePath} (line ${ref.line})\n${ref.diff}\n`,
    language: 'diff',
  });
  await vscode.window.showTextDocument(document, { preview: true });
}
