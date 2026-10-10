import * as vscode from 'vscode';
import type { GitAPI, GitExtension, Repository } from './gitApi';

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
