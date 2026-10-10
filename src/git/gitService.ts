import * as vscode from 'vscode';
import { GitStatus, type GitAPI, type GitExtension, type Repository } from './gitApi';

export class GitUnavailableError extends Error {}

export async function getGitApi(): Promise<GitAPI> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    throw new GitUnavailableError('The built-in Git extension is not installed.');
  }
  const git = extension.isActive ? extension.exports : await extension.activate();
  if (!git.enabled) {
    throw new GitUnavailableError('Git is disabled. Enable the "git.enabled" setting.');
  }
  return git.getAPI(1);
}

/**
 * Picks the repository of the active editor's file, falling back to the first
 * open repository.
 */
export async function getActiveRepository(): Promise<Repository> {
  const api = await getGitApi();
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const repository = (activeUri && api.getRepository(activeUri)) ?? api.repositories[0];
  if (!repository) {
    throw new GitUnavailableError('No git repository is open in this window.');
  }
  return repository;
}

export function getStagedDiff(repository: Repository): Promise<string> {
  return repository.diff(true);
}

export function getUnstagedDiff(repository: Repository): Promise<string> {
  return repository.diff(false);
}

/** The diff a commit introduced relative to its first parent. */
export async function getCommitDiff(repository: Repository, sha: string): Promise<string> {
  const commit = await repository.getCommit(sha);
  const parent = commit.parents[0];
  if (!parent) {
    throw new Error(`Commit ${sha.slice(0, 7)} has no parent; root commits are not supported yet.`);
  }

  const changes = await repository.diffBetween(parent, commit.hash);
  const diffs = await Promise.all(
    changes.map((change) => repository.diffBetween(parent, commit.hash, change.uri.fsPath)),
  );
  return diffs.filter((diff) => diff.length > 0).join('\n');
}

export interface DocumentDiff {
  repository: Repository;
  /** Unified diff whose new side matches the document's line numbers. */
  diff: string;
  /** True for a file git does not track yet; its diff is empty. */
  untracked: boolean;
  /** The file in the working tree the document corresponds to. */
  file: vscode.Uri;
}

/**
 * The diff that lines up with what the given editor shows: HEAD against the
 * working tree for normal files, HEAD against the index for the staged side of
 * a diff editor. Returns undefined for anything else (e.g. the HEAD side).
 */
export async function getDocumentDiff(uri: vscode.Uri): Promise<DocumentDiff | undefined> {
  const api = await getGitApi();

  if (uri.scheme === 'file') {
    const repository = api.getRepository(uri);
    if (!repository) {
      return undefined;
    }
    const untracked = [
      ...repository.state.workingTreeChanges,
      ...(repository.state.untrackedChanges ?? []),
    ].some((c) => c.status === GitStatus.UNTRACKED && c.uri.toString() === uri.toString());
    const diff = untracked ? '' : await repository.diffWith('HEAD', uri.fsPath);
    return { repository, diff, untracked, file: uri };
  }

  const index = parseIndexUri(uri);
  if (index) {
    const repository = api.getRepository(index);
    if (!repository) {
      return undefined;
    }
    return {
      repository,
      diff: await repository.diffIndexWith('HEAD', index.fsPath),
      untracked: false,
      file: index,
    };
  }
  return undefined;
}

/** The file behind a `git:` URI for the staged (index) version, if that is what it is. */
function parseIndexUri(uri: vscode.Uri): vscode.Uri | undefined {
  if (uri.scheme !== 'git') {
    return undefined;
  }
  try {
    const query = JSON.parse(uri.query) as { path?: unknown; ref?: unknown };
    // The git extension uses ref "" for the index side of the staged-changes diff.
    return typeof query.path === 'string' && query.ref === ''
      ? vscode.Uri.file(query.path)
      : undefined;
  } catch {
    return undefined;
  }
}
