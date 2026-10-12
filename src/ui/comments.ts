import * as vscode from 'vscode';
import type { Hunk } from '../git/hunk';
import type { Depth } from '../llm/schemas';
import type { ExplainService } from '../services/explainService';
import { explanationMarkdown, rawExplanationMarkdown, threadTitle } from './explanationMarkdown';
import type { ThreadRegistry, ThreadEntry } from './threads';

const DEEPER: Record<Depth, Depth> = { simple: 'standard', standard: 'deep', deep: 'deep' };
const SIMPLER: Record<Depth, Depth> = { simple: 'simple', standard: 'simple', deep: 'standard' };

/** The explanation part of a Patch Tutor thread. */
export class InlineComments {
  constructor(
    private readonly threads: ThreadRegistry,
    private readonly explainService: ExplainService,
  ) {}

  async explain(
    uri: vscode.Uri,
    located: { hunk: Hunk; repoRoot: string },
    depth: Depth = 'standard',
  ): Promise<void> {
    await this.render(await this.threads.getOrCreate(uri, located), depth);
  }

  /** Re-explains a thread at another depth; `direction` comes from the thread title buttons. */
  async changeDepth(thread: vscode.CommentThread, direction: 'deeper' | 'simpler'): Promise<void> {
    const entry = this.threads.find(thread);
    if (entry) {
      await this.render(entry, (direction === 'deeper' ? DEEPER : SIMPLER)[entry.depth]);
    }
  }

  /** Regenerates a thread's explanation without the cache; the title bar's Refresh button. */
  async refresh(thread: vscode.CommentThread): Promise<void> {
    const entry = this.threads.find(thread);
    if (entry) {
      await this.render(entry, entry.depth, true);
    }
  }

  private async render(entry: ThreadEntry, depth: Depth, skipCache = false): Promise<void> {
    entry.explainController?.abort();
    const controller = new AbortController();
    entry.explainController = controller;
    entry.depth = depth;
    // A new explanation starts a new conversation.
    this.threads.resetChat(entry);
    entry.explained = undefined;
    entry.explanation = this.threads.tutorComment(
      '$(loading~spin) Reading your change and the code around it…',
    );
    this.threads.render(entry);

    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Patch Tutor: explaining…' },
        () =>
          this.explainService.explainHunk(entry.hunk, depth, {
            signal: controller.signal,
            repoRoot: entry.repoRoot,
            skipCache,
          }),
      );
      if (result.kind === 'explanation') {
        entry.explanation = this.threads.tutorComment(
          explanationMarkdown(result.explanation, result.fromCache),
        );
        entry.title = threadTitle(result.explanation);
        entry.explained = result.explanation;
      } else {
        entry.explanation = this.threads.tutorComment(rawExplanationMarkdown(result.text));
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return; // Dismissed or superseded by a newer request.
      }
      entry.explanation = this.threads.errorComment(error, 'get an explanation');
    }
    if (entry.explainController === controller) {
      this.threads.render(entry);
    }
  }
}
