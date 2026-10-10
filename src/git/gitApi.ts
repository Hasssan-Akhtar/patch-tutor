// The subset of the built-in git extension API (vscode.git, getAPI(1)) that
// Patch Tutor uses. Full typings: extensions/git/src/api/git.d.ts in microsoft/vscode.
import type { Event, Uri } from 'vscode';

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): GitAPI;
}

export interface GitAPI {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  getRepository(uri: Uri): Repository | null;
  openRepository(root: Uri): Promise<Repository | null>;
}

export interface Commit {
  readonly hash: string;
  readonly parents: string[];
}

/** Values of the git extension's Status enum that Patch Tutor checks. */
export const enum GitStatus {
  UNTRACKED = 7,
}

export interface Change {
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly status: number;
}

export interface RepositoryState {
  readonly workingTreeChanges: Change[];
  /** Only populated when git.untrackedChanges is "separate". */
  readonly untrackedChanges?: Change[];
  readonly onDidChange: Event<void>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  /** Unified diff of the index (cached) or the working tree against the index. */
  diff(cached?: boolean): Promise<string>;
  /** `git diff <ref> -- <path>`: the working tree file against a ref. */
  diffWith(ref: string, path: string): Promise<string>;
  /** `git diff --cached <ref> -- <path>`: the staged file against a ref. */
  diffIndexWith(ref: string, path: string): Promise<string>;
  getCommit(ref: string): Promise<Commit>;
  /** Files changed between `ref1...ref2`. */
  diffBetween(ref1: string, ref2: string): Promise<Change[]>;
  /** Unified diff of one file between `ref1...ref2`. */
  diffBetween(ref1: string, ref2: string, path: string): Promise<string>;
}
