import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import { ProviderError } from '../llm/provider';
import type { Depth } from '../llm/schemas';
import type { ExplainService } from '../services/explainService';
import { explanationMarkdown, rawExplanationMarkdown } from './explanationMarkdown';
import { hunkRange } from './hunkRange';

const AUTHOR: vscode.CommentAuthorInformation = { name: 'Patch Tutor' };

const DEEPER: Record<Depth, Depth> = { simple: 'standard', standard: 'deep', deep: 'deep' };
const SIMPLER: Record<Depth, Depth> = { simple: 'simple', standard: 'simple', deep: 'standard' };

interface ThreadEntry {
  thread: vscode.CommentThread;
  hunk: Hunk;
  repoRoot: string;
  depth: Depth;
  controller?: AbortController;
}

/** Explanations shown as comment threads under the changed lines. */
export class InlineComments implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController(
    'patch-tutor',
    'Patch Tutor',
  );
  private readonly entries = new Map<string, ThreadEntry>();

  constructor(private readonly explainService: ExplainService) {}

  async explain(
    uri: vscode.Uri,
    located: { hunk: Hunk; repoRoot: string },
    depth: Depth = 'standard',
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const key = `${uri.toString()}#${located.hunk.id}`;
    let entry = this.entries.get(key);
    if (!entry) {
      const thread = this.controller.createCommentThread(
        uri,
        hunkRange(located.hunk, document),
        [],
      );
      thread.canReply = false;
      thread.label = 'Patch Tutor';
      entry = { thread, ...located, depth };
      this.entries.set(key, entry);
    }
    await this.render(entry, depth);
  }

  /** Re-explains a thread at another depth; `direction` comes from the thread title buttons. */
  async changeDepth(thread: vscode.CommentThread, direction: 'deeper' | 'simpler'): Promise<void> {
    const entry = this.find(thread);
    if (entry) {
      const next = (direction === 'deeper' ? DEEPER : SIMPLER)[entry.depth];
      await this.render(entry, next);
    }
  }

  dismiss(thread: vscode.CommentThread): void {
    const entry = this.find(thread);
    entry?.controller?.abort();
    for (const [key, value] of this.entries) {
      if (value.thread === thread) {
        this.entries.delete(key);
      }
    }
    thread.dispose();
  }

  /** Hunk behind a thread, for actions such as Quiz me. */
  hunkFor(thread: vscode.CommentThread): { uri: vscode.Uri; hunk: Hunk } | undefined {
    const entry = this.find(thread);
    return entry && { uri: thread.uri, hunk: entry.hunk };
  }

  /** Open threads on a document; used by integration tests. */
  threadsFor(uri: vscode.Uri): readonly vscode.CommentThread[] {
    return [...this.entries.values()]
      .map((e) => e.thread)
      .filter((t) => t.uri.toString() === uri.toString());
  }

  dispose(): void {
    this.entries.forEach((e) => e.controller?.abort());
    this.controller.dispose();
  }

  private find(thread: vscode.CommentThread): ThreadEntry | undefined {
    return [...this.entries.values()].find((e) => e.thread === thread);
  }

  private async render(entry: ThreadEntry, depth: Depth): Promise<void> {
    entry.controller?.abort();
    const controller = new AbortController();
    entry.controller = controller;
    entry.depth = depth;
    const { thread } = entry;
    thread.contextValue = `patchTutorThread ${depth}`;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.comments = [comment(markdown('$(loading~spin) Explaining this change…'))];

    let body: vscode.MarkdownString;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Patch Tutor: explaining…' },
        () =>
          this.explainService.explainHunk(entry.hunk, depth, {
            signal: controller.signal,
            repoRoot: entry.repoRoot,
          }),
      );
      body =
        result.kind === 'explanation'
          ? markdown(explanationMarkdown(result.explanation, result.fromCache))
          : markdown(rawExplanationMarkdown(result.text));
    } catch (error) {
      if (controller.signal.aborted) {
        return; // Dismissed or superseded by a newer request.
      }
      body = errorMarkdown(error);
    }
    if (entry.controller === controller) {
      thread.comments = [comment(body)];
    }
  }
}

function markdown(text: string): vscode.MarkdownString {
  // Theme icons only; model output is never trusted to run commands.
  return new vscode.MarkdownString(text, true);
}

function comment(body: vscode.MarkdownString): vscode.Comment {
  return { body, mode: vscode.CommentMode.Preview, author: AUTHOR };
}

function errorMarkdown(error: unknown): vscode.MarkdownString {
  if (error instanceof ProviderError && error.kind === 'cancelled') {
    return new vscode.MarkdownString('Cancelled.');
  }
  const message = error instanceof Error ? error.message : String(error);
  const md = new vscode.MarkdownString(
    `$(warning) ${message}\n\n[Test connection](command:patchTutor.testConnection) · [Choose provider](command:patchTutor.chooseProvider)`,
    true,
  );
  // Only our own two commands may run from this message.
  md.isTrusted = { enabledCommands: ['patchTutor.testConnection', 'patchTutor.chooseProvider'] };
  return md;
}
