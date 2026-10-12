import type { Hunk } from '../git/hunk';
import type { LLMProvider } from '../llm/provider';
import { FollowUpAnswerSchema, FollowUpSchema, type Depth, type Explanation } from '../llm/schemas';
import { completeStructured, parseJson } from '../llm/structured';
import followUpPrompt from '../prompts/follow-up.md';
import followUpUserPrompt from '../prompts/follow-up-user.md';
import { renderTemplate } from '../prompts/render';
import { hunkPromptValues, type HunkContext } from './explainService';

/** Older exchanges are dropped first so a long chat stays within the prompt budget. */
export const MAX_EXCHANGES = 6;

export interface Exchange {
  question: string;
  answer: string;
}

export interface FollowUpDeps {
  createProvider: () => LLMProvider;
  buildContext: (
    hunk: Hunk,
    repoRoot: string | undefined,
    signal?: AbortSignal,
  ) => Promise<HunkContext>;
  maxOutputTokens: () => number;
}

export interface FollowUpRequest {
  hunk: Hunk;
  repoRoot: string | undefined;
  depth: Depth;
  /** The explanation as the user currently sees it, including earlier revisions. */
  explanation: Explanation;
  history: readonly Exchange[];
  question: string;
  /** Context from an earlier follow-up on the same explanation; built when missing. */
  context?: HunkContext;
  signal?: AbortSignal;
}

export interface FollowUpResult {
  /** The context used, kept by the caller for the next follow-up. */
  context: HunkContext;
  answer: string;
  revised?: Explanation;
  /** False when the reply never matched the schema and `answer` is the raw text. */
  structured: boolean;
}

/** Answers questions and pushback about an explanation. Answers are not cached. */
export class FollowUpService {
  constructor(private readonly deps: FollowUpDeps) {}

  async ask(request: FollowUpRequest): Promise<FollowUpResult> {
    const context =
      request.context ??
      (await this.deps.buildContext(request.hunk, request.repoRoot, request.signal));
    const result = await completeStructured(
      this.deps.createProvider(),
      {
        system: followUpPrompt,
        user: buildFollowUpUserMessage(request, context),
        maxTokens: this.deps.maxOutputTokens(),
        signal: request.signal,
      },
      FollowUpSchema,
    );
    if (!result.ok) {
      // A broken revision should not hide a good answer behind raw JSON.
      const salvaged = parseJson(result.raw, FollowUpAnswerSchema);
      const answer = salvaged.ok ? salvaged.value.answer : result.raw.trim();
      return { context, answer, structured: false };
    }
    return {
      context,
      answer: result.value.answer,
      revised: result.value.revised,
      structured: true,
    };
  }
}

export function buildFollowUpUserMessage(request: FollowUpRequest, context: HunkContext): string {
  return renderTemplate(followUpUserPrompt, {
    depth: request.depth,
    ...hunkPromptValues(request.hunk, context),
    explanation: explanationForPrompt(request.explanation),
    conversation: conversationForPrompt(request.history),
    question: request.question.trim(),
  });
}

export function explanationForPrompt(e: Explanation): string {
  const risks = e.risks.length > 0 ? e.risks.map((r) => `\n- ${r}`).join('') : ' none';
  return [
    `Summary: ${e.summary}`,
    `What changed: ${e.whatChanged}`,
    `How it works: ${e.howItWorks}`,
    `Why it works: ${e.whyItWorks}`,
    `Concepts: ${e.concepts.join(', ') || 'none'}`,
    `Risks:${risks}`,
  ].join('\n');
}

export function conversationForPrompt(history: readonly Exchange[]): string {
  const recent = history.slice(-MAX_EXCHANGES);
  if (recent.length === 0) {
    return '(none yet)';
  }
  const dropped = history.length - recent.length;
  const note =
    dropped > 0 ? `(${dropped} earlier exchange${dropped === 1 ? '' : 's'} left out)\n\n` : '';
  return note + recent.map((x) => `Developer: ${x.question}\n\nTutor: ${x.answer}`).join('\n\n');
}
