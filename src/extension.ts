import * as path from 'node:path';
import * as vscode from 'vscode';
import { ExplanationCache } from './cache/explanationCache';
import { buildHunkContext } from './context/contextBuilder';
import { fixtureContext, runPromptEvals } from './dev/promptEvals';
import { parseUnifiedDiff } from './git/diffParser';
import { getActiveRepository, getStagedDiff } from './git/gitService';
import type { Hunk } from './git/hunk';
import { ReportStore } from './learning/reports';
import { metered } from './llm/metered';
import type { LLMProvider } from './llm/provider';
import { ExplainService } from './services/explainService';
import { HunkService } from './services/hunkService';
import { QuizService } from './services/quizService';
import { createProvider, getModelKey } from './services/providerService';
import { HUNK_DOCUMENT_SELECTOR, HunkCodeLensProvider } from './ui/codeLens';
import { InlineComments } from './ui/comments';
import { HunkDecorations } from './ui/decorations';
import { registerExplainCommands } from './ui/explainCommands';
import { HunkHoverProvider } from './ui/hover';
import { registerInlineCommands } from './ui/inlineCommands';
import { registerProviderCommands } from './ui/providerCommands';
import { QuizThreads } from './ui/quizThreads';
import { StatusBar } from './ui/statusBar';
import { ThreadRegistry } from './ui/threads';

/** Returned from activate() so integration tests can inspect state and swap the provider. */
export interface PatchTutorTestApi {
  threads: ThreadRegistry;
  hunks: HunkService;
  setProviderOverride(provider: LLMProvider | undefined): void;
}

export function activate(context: vscode.ExtensionContext): PatchTutorTestApi {
  const output = vscode.window.createOutputChannel('Patch Tutor');
  const config = () => vscode.workspace.getConfiguration('patchTutor');
  const statusBar = new StatusBar(context.globalState);
  let providerOverride: LLMProvider | undefined;
  const provider = () => metered(providerOverride ?? createProvider(), statusBar.recordUsage);

  const buildContext = async (hunk: Hunk, repoRoot: string | undefined, signal?: AbortSignal) =>
    buildHunkContext(
      hunk,
      repoRoot ? vscode.Uri.file(repoRoot) : (await getActiveRepository()).rootUri,
      config().get<number>('contextTokenBudget', 6000),
      signal,
    );
  const maxOutputTokens = () => config().get<number>('maxOutputTokens', 1200);

  const explainService = new ExplainService({
    createProvider: provider,
    modelKey: getModelKey,
    buildContext,
    cache: new ExplanationCache(
      vscode.Uri.joinPath(context.globalStorageUri, 'explanations.json').fsPath,
    ),
    maxOutputTokens,
  });
  const quizService = new QuizService({ createProvider: provider, buildContext, maxOutputTokens });

  const hunks = new HunkService();
  const threads = new ThreadRegistry(context.extensionUri);
  const comments = new InlineComments(threads, explainService);
  const quizzes = new QuizThreads(threads, quizService);
  context.subscriptions.push(
    output,
    statusBar,
    hunks,
    threads,
    quizzes,
    new HunkDecorations(context.extensionUri, hunks),
    vscode.languages.registerCodeLensProvider(
      HUNK_DOCUMENT_SELECTOR,
      new HunkCodeLensProvider(hunks),
    ),
    vscode.languages.registerHoverProvider(HUNK_DOCUMENT_SELECTOR, new HunkHoverProvider(hunks)),
    vscode.commands.registerCommand('patchTutor.listStagedHunks', () => listStagedHunks(output)),
  );
  registerProviderCommands(context);
  registerExplainCommands(context, explainService, output);
  registerInlineCommands(
    context,
    hunks,
    threads,
    comments,
    quizzes,
    new ReportStore(vscode.Uri.joinPath(context.globalStorageUri, 'reports.jsonl').fsPath),
  );

  if (context.extensionMode === vscode.ExtensionMode.Development) {
    registerDevCommands(context, provider);
  }

  return {
    threads,
    hunks,
    setProviderOverride: (p) => {
      providerOverride = p;
    },
  };
}

export function deactivate(): void {}

function registerDevCommands(context: vscode.ExtensionContext, provider: () => LLMProvider): void {
  const config = () => vscode.workspace.getConfiguration('patchTutor');
  const evalService = new ExplainService({
    createProvider: provider,
    modelKey: getModelKey,
    buildContext: fixtureContext,
    cache: new ExplanationCache(
      vscode.Uri.joinPath(context.globalStorageUri, 'eval-cache.json').fsPath,
    ),
    maxOutputTokens: () => config().get<number>('maxOutputTokens', 1200),
  });
  void vscode.commands.executeCommand('setContext', 'patchTutor.devMode', true);
  context.subscriptions.push(
    vscode.commands.registerCommand('patchTutor.dev.runPromptEvals', () =>
      runPromptEvals(context.extensionUri, evalService, getModelKey()),
    ),
  );
}

async function listStagedHunks(output: vscode.OutputChannel): Promise<void> {
  try {
    const repository = await getActiveRepository();
    const hunks = parseUnifiedDiff(await getStagedDiff(repository));
    output.clear();
    output.appendLine(
      `${hunks.length} staged hunk(s) in ${path.basename(repository.rootUri.fsPath)}`,
    );
    for (const hunk of hunks) {
      output.appendLine(formatHunk(hunk));
    }
    output.show(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Patch Tutor: ${message}`);
  }
}

function formatHunk(hunk: Hunk): string {
  const file = hunk.oldPath ? `${hunk.oldPath} -> ${hunk.filePath}` : hunk.filePath;
  const end = hunk.newStart + Math.max(hunk.newLines, 1) - 1;
  return `\n${file} [${hunk.status}] lines ${hunk.newStart}-${end} (+${hunk.added.length} -${hunk.removed.length})\n${hunk.raw}`;
}
