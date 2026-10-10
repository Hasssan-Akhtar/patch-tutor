import { createHash } from 'node:crypto';
import { cacheKey, type ExplanationCache } from '../cache/explanationCache';
import type { ContextSection } from '../context/budget';
import type { Hunk } from '../git/hunk';
import type { LLMProvider } from '../llm/provider';
import { ExplanationSchema, type Depth, type Explanation } from '../llm/schemas';
import { completeStructured } from '../llm/structured';
import explainPrompt from '../prompts/explain.md';
import explainUserPrompt from '../prompts/explain-user.md';
import fixJsonPrompt from '../prompts/fix-json.md';
import { renderTemplate } from '../prompts/render';

export interface HunkContext {
  languageId: string;
  frameworks: string[];
  sections: ContextSection[];
  /** Titles of sections dropped to stay within the token budget. */
  dropped: string[];
  /** The diff to send; may be truncated for very large hunks. */
  diff: string;
}

export type ExplainResult =
  | { kind: 'explanation'; explanation: Explanation; fromCache: boolean }
  | { kind: 'raw'; text: string; error: string };

export interface ExplainDeps {
  createProvider: () => LLMProvider;
  /** Identifies the provider and model for cache keys. */
  modelKey: () => string;
  buildContext: (hunk: Hunk, signal?: AbortSignal) => Promise<HunkContext>;
  cache: ExplanationCache;
  maxOutputTokens: () => number;
}

export const EXPLAIN_PROMPT_VERSION = createHash('sha1')
  .update(explainPrompt)
  .update(explainUserPrompt)
  .update(fixJsonPrompt)
  .digest('hex')
  .slice(0, 12);

export class ExplainService {
  constructor(private readonly deps: ExplainDeps) {}

  async explainHunk(hunk: Hunk, depth: Depth, signal?: AbortSignal): Promise<ExplainResult> {
    const key = cacheKey({
      hunkId: hunk.id,
      depth,
      model: this.deps.modelKey(),
      promptVersion: EXPLAIN_PROMPT_VERSION,
    });
    const cached = await this.deps.cache.get(key);
    if (cached) {
      return { kind: 'explanation', explanation: cached, fromCache: true };
    }

    const context = await this.deps.buildContext(hunk, signal);
    const result = await completeStructured(
      this.deps.createProvider(),
      {
        system: explainPrompt,
        user: buildExplainUserMessage(hunk, depth, context),
        maxTokens: this.deps.maxOutputTokens(),
        signal,
      },
      ExplanationSchema,
    );

    if (!result.ok) {
      return { kind: 'raw', text: result.raw, error: result.error };
    }
    await this.deps.cache.set(key, result.value);
    return { kind: 'explanation', explanation: result.value, fromCache: false };
  }
}

export function buildExplainUserMessage(hunk: Hunk, depth: Depth, context: HunkContext): string {
  const sections = context.sections.map(
    (s) => `### ${s.title}\n\n\`\`\`${context.languageId}\n${s.text}\n\`\`\``,
  );
  return renderTemplate(explainUserPrompt, {
    depth,
    filePath: hunk.oldPath ? `${hunk.oldPath} -> ${hunk.filePath}` : hunk.filePath,
    status: hunk.status,
    language: context.languageId,
    frameworks: context.frameworks.length > 0 ? context.frameworks.join(', ') : 'none detected',
    diff: context.diff,
    context: sections.length > 0 ? sections.join('\n\n') : '(no additional context available)',
  });
}
