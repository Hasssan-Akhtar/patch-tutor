import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseUnifiedDiff, untrackedFileHunks } from '../git/diffParser';
import { getDocumentDiff, getGitApi } from '../git/gitService';
import type { Repository } from '../git/gitApi';
import type { Hunk } from '../git/hunk';

export interface DocumentHunks {
  hunks: Hunk[];
  /** File system path of the repository root. */
  repoRoot: string;
}

const REFRESH_DELAY_MS = 300;

/**
 * Hunks for open documents, cached until the file is saved or git state
 * changes. Fires `onDidChange` so CodeLens and decorations can refresh.
 */
export class HunkService implements vscode.Disposable {
  private readonly cache = new Map<string, Promise<DocumentHunks | undefined>>();
  private readonly changed = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private readonly watched = new Set<Repository>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  readonly onDidChange = this.changed.event;

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument(() => this.invalidate()),
      vscode.workspace.onDidCloseTextDocument((doc) => this.cache.delete(doc.uri.toString())),
    );
    void this.watchRepositories();
  }

  getHunks(document: vscode.TextDocument): Promise<DocumentHunks | undefined> {
    const key = document.uri.toString();
    let entry = this.cache.get(key);
    if (!entry) {
      entry = this.load(document).catch(() => undefined);
      this.cache.set(key, entry);
    }
    return entry;
  }

  async findHunk(
    uri: vscode.Uri,
    hunkId: string,
  ): Promise<(DocumentHunks & { hunk: Hunk }) | undefined> {
    const document = await vscode.workspace.openTextDocument(uri);
    const result = await this.getHunks(document);
    const hunk = result?.hunks.find((h) => h.id === hunkId);
    return result && hunk ? { ...result, hunk } : undefined;
  }

  /** Drops cached hunks and tells listeners, debounced because git fires bursts of events. */
  invalidate(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.cache.clear();
      this.changed.fire();
    }, REFRESH_DELAY_MS);
  }

  dispose(): void {
    clearTimeout(this.refreshTimer);
    this.disposables.forEach((d) => d.dispose());
  }

  private async load(document: vscode.TextDocument): Promise<DocumentHunks | undefined> {
    const result = await getDocumentDiff(document.uri);
    if (!result) {
      return undefined;
    }
    const repoRoot = result.repository.rootUri.fsPath;
    const relative = path.relative(repoRoot, result.file.fsPath).split(path.sep).join('/');
    const hunks = result.untracked
      ? untrackedFileHunks(relative, document.getText())
      : parseUnifiedDiff(result.diff).filter((h) => h.status !== 'deleted');
    return { hunks, repoRoot };
  }

  private async watchRepositories(): Promise<void> {
    try {
      const api = await getGitApi();
      api.repositories.forEach((r) => this.watch(r));
      this.disposables.push(api.onDidOpenRepository((r) => this.watch(r)));
    } catch {
      // Git unavailable: there is nothing to watch, and getHunks returns nothing.
    }
  }

  private watch(repository: Repository): void {
    if (!this.watched.has(repository)) {
      this.watched.add(repository);
      this.disposables.push(repository.state.onDidChange(() => this.invalidate()));
      this.invalidate();
    }
  }
}
