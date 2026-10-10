// The subset of the built-in git extension API (vscode.git, getAPI(1)) that
// Patch Tutor uses. Full typings: extensions/git/src/api/git.d.ts in microsoft/vscode.
import type { Uri } from 'vscode';

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  readonly repositories: Repository[];
  getRepository(uri: Uri): Repository | null;
  openRepository(root: Uri): Promise<Repository | null>;
}

export interface Commit {
  readonly hash: string;
  readonly parents: string[];
}

export interface Change {
  readonly uri: Uri;
  readonly originalUri: Uri;
}

export interface Repository {
  readonly rootUri: Uri;
  /** Unified diff of the index (cached) or the working tree against the index. */
  diff(cached?: boolean): Promise<string>;
  getCommit(ref: string): Promise<Commit>;
  /** Files changed between `ref1...ref2`. */
  diffBetween(ref1: string, ref2: string): Promise<Change[]>;
  /** Unified diff of one file between `ref1...ref2`. */
  diffBetween(ref1: string, ref2: string, path: string): Promise<string>;
}
