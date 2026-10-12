# Explanation Follow-up Chat and Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users ask follow-up questions or push back on an inline explanation (in the thread or the sidebar chat), and regenerate an explanation with a Refresh button.

**Architecture:** A pure `FollowUpService` builds the prompt (diff, hunk context, current explanation, last 6 exchanges) and parses `{ answer, revised? }` with zod. An `ExplanationChat` class, shaped like `QuizRun`, holds one conversation and is rendered by both the comment thread (`ThreadRegistry`) and the sidebar (`ChatView`). Reply-box buttons are chosen by the thread's `contextValue` suffix: ` quiz` (unchanged), ` chat` or ` chat started`.

**Tech Stack:** TypeScript (strict), VS Code extension API (stable only), zod, Vitest (+ happy-dom for webview), `@vscode/test-cli` integration tests, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-12-explanation-follow-up-chat-design.md`

**One deliberate deviation from the spec:** the spec says the explain step stores its `HunkContext` on the thread entry. A cache hit in `ExplainService` never builds context, so instead `FollowUpService` builds context on the first follow-up and `ExplanationChat` keeps it for later turns. Same effect (no repeated language-server lookups), and it also works for cached explanations. `ExplainService` is not changed.

## Global Constraints

- TypeScript strict. No `any` without a comment explaining why.
- No network calls except to the user's configured LLM provider.
- No proposed VS Code APIs.
- All LLM output is parsed with zod schemas in `src/llm/schemas.ts`.
- Prompts live in `src/prompts/*.md`, never inline in TypeScript.
- Pure logic has Vitest tests.
- UI code stays in `src/ui/`; it must not call providers directly (it calls services).
- Never commit personal or machine-specific info: no absolute home paths, usernames, emails, hostnames, keys, or local editor config.
- Only the last 6 exchanges are sent with a follow-up.
- Revised explanations are never written to the explanation cache.
- Refresh, a depth change, or closing the thread aborts in-flight chat requests (a chat moved to the sidebar keeps going there).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A model that sends `"revised": null` instead of omitting the field: treated as "no revision" (Task 1 schema test).
2. Following up on an explanation that came from the cache (no context built yet): context is built once on the first follow-up and reused after (Task 1 service test, Task 2 chat test).
3. Sending a second message while the first is still pending: returns `'not-ready'` and adds no messages (Task 2 test).
4. Dismissing the thread or refreshing while a follow-up is in flight: no answer or error appears afterwards (Task 2 cancel test).
5. Replying while a quiz is waiting for an answer: the reply box stays a quiz box (` quiz` suffix, quiz buttons), not a chat box (Task 3 integration test).

---

### Task 0: Commit the pending model-dropdown fix

The working tree already has an unrelated, tested fix (`src/ui/chat/chatHtml.ts`, `test/unit/chatSettings.test.ts`) that names the model "VS Code models" uses by default. Commit it alone so later commits stay focused.

- [ ] **Step 1: Verify and commit**

Run: `npm test -- test/unit/chatSettings.test.ts`
Expected: PASS (7 tests)

```bash
git add src/ui/chat/chatHtml.ts test/unit/chatSettings.test.ts
git commit -m "Name the model VS Code models uses when none is chosen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Follow-up schema, prompts and service

**Files:**
- Modify: `src/llm/schemas.ts` (append)
- Create: `src/prompts/follow-up.md`
- Create: `src/prompts/follow-up-user.md`
- Create: `src/services/followUpService.ts`
- Test: `test/unit/followUpService.test.ts`

**Interfaces:**
- Consumes: `ExplanationSchema`, `Explanation`, `Depth` (`src/llm/schemas.ts`); `completeStructured` (`src/llm/structured.ts`); `renderTemplate` (`src/prompts/render.ts`); `hunkPromptValues`, `HunkContext` (`src/services/explainService.ts`); `LLMProvider` (`src/llm/provider.ts`).
- Produces:
  - `FollowUpSchema` and `type FollowUp = { answer: string; revised: Explanation | undefined }`
  - `MAX_EXCHANGES = 6`
  - `interface Exchange { question: string; answer: string }`
  - `interface FollowUpDeps { createProvider: () => LLMProvider; buildContext: (hunk: Hunk, repoRoot: string | undefined, signal?: AbortSignal) => Promise<HunkContext>; maxOutputTokens: () => number }`
  - `interface FollowUpRequest { hunk: Hunk; repoRoot: string | undefined; depth: Depth; explanation: Explanation; history: readonly Exchange[]; question: string; context?: HunkContext; signal?: AbortSignal }`
  - `interface FollowUpResult { context: HunkContext; answer: string; revised?: Explanation; structured: boolean }`
  - `class FollowUpService { constructor(deps: FollowUpDeps); ask(request: FollowUpRequest): Promise<FollowUpResult> }`
  - `buildFollowUpUserMessage(request: FollowUpRequest, context: HunkContext): string`
  - `explanationForPrompt(e: Explanation): string`
  - `conversationForPrompt(history: readonly Exchange[]): string`

- [ ] **Step 1: Write the failing tests**

Create `test/unit/followUpService.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Hunk } from '../../src/git/hunk';
import type { LLMProvider } from '../../src/llm/provider';
import { FollowUpSchema, type Explanation } from '../../src/llm/schemas';
import followUpPrompt from '../../src/prompts/follow-up.md';
import type { HunkContext } from '../../src/services/explainService';
import {
  conversationForPrompt,
  FollowUpService,
  MAX_EXCHANGES,
  type Exchange,
  type FollowUpRequest,
} from '../../src/services/followUpService';

const hunk: Hunk = {
  id: 'h1',
  filePath: 'src/cart.js',
  status: 'modified',
  newStart: 1,
  newLines: 2,
  oldStart: 1,
  oldLines: 1,
  added: ['  return 0;'],
  removed: [],
  raw: '@@ -1,1 +1,2 @@\n function total() {\n+  return 0;',
};

const context: HunkContext = {
  languageId: 'javascript',
  frameworks: [],
  sections: [{ title: 'Enclosing code (lines 1-3)', text: 'function total() {}', priority: 1 }],
  dropped: [],
  diff: hunk.raw,
};

const explanation: Explanation = {
  summary: 'Returns zero early.',
  whatChanged: 'Adds a return.',
  howItWorks: 'It returns 0.',
  whyItWorks: 'Nothing else runs.',
  concepts: ['edge-cases'],
  risks: [],
  depth: 'standard',
};

function setup(reply: string | string[]) {
  const replies = Array.isArray(reply) ? [...reply] : [reply];
  const complete = vi.fn<LLMProvider['complete']>(async () => replies.shift() ?? '');
  const buildContext = vi.fn(async () => context);
  const service = new FollowUpService({
    createProvider: () => ({ id: 'vscodeLm', name: 'fake', complete }),
    buildContext,
    maxOutputTokens: () => 500,
  });
  const request: FollowUpRequest = {
    hunk,
    repoRoot: '/repo',
    depth: 'standard',
    explanation,
    history: [],
    question: '  Why return early?  ',
  };
  return { service, complete, buildContext, request };
}

describe('FollowUpSchema', () => {
  it('accepts an answer with or without a revision', () => {
    expect(FollowUpSchema.parse({ answer: 'Yes.' })).toEqual({ answer: 'Yes.', revised: undefined });
    expect(FollowUpSchema.parse({ answer: 'Fixed.', revised: explanation }).revised).toEqual(
      explanation,
    );
  });

  it('treats a null revision as no revision', () => {
    expect(FollowUpSchema.parse({ answer: 'No.', revised: null }).revised).toBeUndefined();
  });

  it('rejects an empty answer', () => {
    expect(FollowUpSchema.safeParse({ answer: '' }).success).toBe(false);
  });
});

describe('conversationForPrompt', () => {
  const exchange = (n: number): Exchange => ({ question: `Q${n}?`, answer: `A${n}.` });

  it('says when there is no conversation yet', () => {
    expect(conversationForPrompt([])).toBe('(none yet)');
  });

  it(`keeps only the last ${MAX_EXCHANGES} exchanges and notes how many were left out`, () => {
    const history = Array.from({ length: MAX_EXCHANGES + 2 }, (_, i) => exchange(i + 1));
    const text = conversationForPrompt(history);
    expect(text).toMatch(/^\(2 earlier exchanges left out\)/);
    expect(text).not.toContain('Q2?');
    expect(text).toContain('Developer: Q3?');
    expect(text).toContain(`Tutor: A${MAX_EXCHANGES + 2}.`);
  });
});

describe('FollowUpService', () => {
  it('sends the diff, context, explanation, conversation and trimmed question', async () => {
    const { service, complete, request } = setup(JSON.stringify({ answer: 'To skip the loop.' }));

    const result = await service.ask({
      ...request,
      history: [{ question: 'What changed?', answer: 'A return.' }],
    });

    expect(result).toEqual({ context, answer: 'To skip the loop.', revised: undefined, structured: true });
    const sent = complete.mock.calls[0]?.[0];
    expect(sent?.system).toBe(followUpPrompt);
    expect(sent?.json).toBe(true);
    expect(sent?.user).toContain('+  return 0;');
    expect(sent?.user).toContain('function total() {}');
    expect(sent?.user).toContain('Summary: Returns zero early.');
    expect(sent?.user).toContain('Developer: What changed?');
    expect(sent?.user).toMatch(/## Their new message\n\nWhy return early\?\n?$/);
  });

  it('builds context only when none is passed in', async () => {
    const { service, buildContext, request } = setup([
      JSON.stringify({ answer: 'One.' }),
      JSON.stringify({ answer: 'Two.' }),
    ]);

    const first = await service.ask(request);
    await service.ask({ ...request, context: first.context });

    expect(buildContext).toHaveBeenCalledTimes(1);
  });

  it('returns a revision when the tutor corrects itself', async () => {
    const revised = { ...explanation, whyItWorks: 'Callers get 0 for empty carts.' };
    const { service, request } = setup(JSON.stringify({ answer: 'You are right.', revised }));

    expect((await service.ask(request)).revised).toEqual(revised);
  });

  it('falls back to the raw text when the reply never matches the schema', async () => {
    const { service, request } = setup(['not json', '  Plain answer.  ']);

    expect(await service.ask(request)).toEqual({
      context,
      answer: 'Plain answer.',
      structured: false,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/unit/followUpService.test.ts`
Expected: FAIL. The imports `FollowUpSchema`, `../../src/prompts/follow-up.md` and `../../src/services/followUpService` don't exist.

- [ ] **Step 3: Add the schema**

Append to `src/llm/schemas.ts`:

```ts
export const FollowUpSchema = z.object({
  answer: z.string().min(1),
  // Some models send null instead of leaving the field out.
  revised: ExplanationSchema.nullish().transform((value) => value ?? undefined),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;
```

- [ ] **Step 4: Write the prompts**

Create `src/prompts/follow-up.md`:

```markdown
You are Patch Tutor, a patient senior developer. A colleague read your explanation of one hunk from a git diff and replied with a follow-up question or a disagreement. You are a mentor, never a judge.

You receive the hunk, context from the same codebase, the explanation they read, the conversation so far, and their new message.

Rules:

- Answer from the diff and context you were given. Never invent functions, files or behavior that are not shown. If they are not enough to be sure, say "I'm not sure" and what is missing.
- Answer the message directly in one to five sentences. Use Markdown inline code for identifiers. Match the depth: simple means plain words and no jargon; standard and deep are direct and technical.
- If the message disputes a claim in the explanation, re-read the diff before answering. Count calls, compare old and new lines, and check types.
  - If the diff shows they are right, say so plainly, explain what is actually true, and return `revised`: the full explanation with the mistake corrected and everything else kept.
  - If the diff shows the explanation was right, keep your position. Explain politely and concretely, pointing to the lines that show it. Do not return `revised`. Agreeing with a wrong claim to be polite teaches the wrong thing.
  - If you cannot tell from what you were given, say what is missing. Do not return `revised`.
- Return `revised` only to correct a mistake in the explanation, never because a question was asked or answered.
- `revised` follows the rules of the original: each field one to four sentences, concepts lowercase, every risk true of the code shown, and the same depth.

Reply with only a JSON object, no prose and no code fences, matching exactly:

{
  "answer": "string",
  "revised": {
    "summary": "string",
    "whatChanged": "string",
    "howItWorks": "string",
    "whyItWorks": "string",
    "concepts": ["string"],
    "risks": ["string"],
    "depth": "simple" | "standard" | "deep"
  }
}

Leave out `revised` entirely when nothing in the explanation was wrong.
```

Create `src/prompts/follow-up-user.md` (note: the fenced block below is the file's content, which itself contains a ```diff fence):

````markdown
Depth: {{depth}}
File: {{filePath}} ({{status}}): {{statusNote}}
Language: {{language}}
Frameworks: {{frameworks}}

## The change

```diff
{{diff}}
```

## Context from the codebase

{{context}}

## The explanation they read

{{explanation}}

## Conversation so far

{{conversation}}

## Their new message

{{question}}
````

The file ends right after `{{question}}` (one trailing newline is fine; the test allows it).

- [ ] **Step 5: Write the service**

Create `src/services/followUpService.ts`:

```ts
import type { Hunk } from '../git/hunk';
import type { LLMProvider } from '../llm/provider';
import { FollowUpSchema, type Depth, type Explanation } from '../llm/schemas';
import { completeStructured } from '../llm/structured';
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
      return { context, answer: result.raw.trim(), structured: false };
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
  const note = dropped > 0 ? `(${dropped} earlier exchange${dropped === 1 ? '' : 's'} left out)\n\n` : '';
  return note + recent.map((x) => `Developer: ${x.question}\n\nTutor: ${x.answer}`).join('\n\n');
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -- test/unit/followUpService.test.ts && npm run typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/llm/schemas.ts src/prompts/follow-up.md src/prompts/follow-up-user.md src/services/followUpService.ts test/unit/followUpService.test.ts
git commit -m "Add a follow-up service that answers questions about an explanation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ExplanationChat conversation model

**Files:**
- Create: `src/ui/explanationChat.ts`
- Modify: `src/ui/quizRun.ts` (export the existing `failure` helper as `failureMarkdown`)
- Test: `test/unit/explanationChat.test.ts`

**Interfaces:**
- Consumes: `FollowUpService`, `Exchange` (Task 1); `QuizMessage` (`src/ui/quizRun.ts`); `escapeModelText` (`src/ui/markdownStyle.ts`); `HunkContext`.
- Produces:
  - `failureMarkdown(what: string, error: unknown): string` exported from `src/ui/quizRun.ts`
  - `type AskResult = 'answered' | 'empty' | 'not-ready' | 'failed'`
  - `class ExplanationChat` with: `constructor(hunk: Hunk, repoRoot: string, depth: Depth, explanation: Explanation, followUps: FollowUpService)`; readonly `hunk`, `repoRoot`, `depth`, `messages: QuizMessage[]`; mutable `explanation: Explanation`, `busy: boolean`, `revised: boolean`; getters `canSend`, `cancelled`; methods `onDidChange(listener: () => void): { dispose(): void }`, `ask(text: string): Promise<AskResult>`, `cancel(): void`.

- [ ] **Step 1: Write the failing tests**

Create `test/unit/explanationChat.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Hunk } from '../../src/git/hunk';
import type { LLMProvider } from '../../src/llm/provider';
import type { Explanation } from '../../src/llm/schemas';
import type { HunkContext } from '../../src/services/explainService';
import { FollowUpService } from '../../src/services/followUpService';
import { ExplanationChat } from '../../src/ui/explanationChat';

const hunk: Hunk = {
  id: 'h1',
  filePath: 'src/cart.js',
  status: 'modified',
  newStart: 1,
  newLines: 1,
  oldStart: 1,
  oldLines: 1,
  added: ['x'],
  removed: [],
  raw: '@@ -1 +1 @@\n+x',
};

const context: HunkContext = {
  languageId: 'javascript',
  frameworks: [],
  sections: [],
  dropped: [],
  diff: hunk.raw,
};

const explanation: Explanation = {
  summary: 'Sets x.',
  whatChanged: 'Adds x.',
  howItWorks: 'It assigns.',
  whyItWorks: 'Fewer calls.',
  concepts: ['naming'],
  risks: [],
  depth: 'standard',
};

function setup(complete: LLMProvider['complete']) {
  const buildContext = vi.fn(async () => context);
  const chat = new ExplanationChat(
    hunk,
    '/repo',
    'standard',
    explanation,
    new FollowUpService({
      createProvider: () => ({ id: 'vscodeLm', name: 'fake', complete }),
      buildContext,
      maxOutputTokens: () => 500,
    }),
  );
  return { chat, buildContext };
}

const reply = (value: object) => async () => JSON.stringify(value);

describe('ExplanationChat', () => {
  it('shows the question and a pending reply, then the answer', async () => {
    const { chat } = setup(reply({ answer: 'Because `x` is new.' }));
    const changes: string[] = [];
    chat.onDidChange(() => changes.push(chat.messages.map((m) => m.from).join(',')));

    const pending = chat.ask('  Why x?  ');
    expect(chat.busy).toBe(true);
    expect(chat.canSend).toBe(false);
    expect(chat.messages).toEqual([
      { from: 'you', text: 'Why x?' },
      { from: 'tutor', text: 'Thinking…', pending: true },
    ]);

    expect(await pending).toBe('answered');
    expect(chat.busy).toBe(false);
    expect(chat.messages.at(-1)).toEqual({ from: 'tutor', text: 'Because `x` is new.' });
    expect(changes).toEqual(['you,tutor', 'you,tutor']);
  });

  it('ignores blank messages and messages sent while busy', async () => {
    const { chat } = setup(reply({ answer: 'Done.' }));
    expect(await chat.ask('   ')).toBe('empty');

    const first = chat.ask('One?');
    expect(await chat.ask('Two?')).toBe('not-ready');
    await first;
    expect(chat.messages.filter((m) => m.from === 'you')).toHaveLength(1);
  });

  it('sends earlier exchanges and reuses context on later questions', async () => {
    const complete = vi.fn<LLMProvider['complete']>(reply({ answer: 'A.' }));
    const { chat, buildContext } = setup(complete);

    await chat.ask('First?');
    await chat.ask('Second?');

    expect(buildContext).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[1]?.[0].user).toContain('Developer: First?');
  });

  it('replaces the explanation when the tutor revises it, keeping its depth', async () => {
    const revised = { ...explanation, whyItWorks: 'Same calls, smaller rows.', depth: 'deep' };
    const { chat } = setup(reply({ answer: 'You are right.', revised }));

    await chat.ask('It does not reduce calls, does it?');

    expect(chat.revised).toBe(true);
    expect(chat.explanation).toEqual({ ...revised, depth: 'standard' });
    expect(chat.messages.at(-1)?.text).toMatch(/You are right\.[\s\S]*corrected the explanation/);
  });

  it('escapes HTML in answers', async () => {
    const { chat } = setup(reply({ answer: '<img src=x> ![a](b)' }));
    await chat.ask('Q?');
    expect(chat.messages.at(-1)?.text).not.toContain('<img');
    expect(chat.messages.at(-1)?.text).toContain('!\\[');
  });

  it('shows a provider error and stays usable', async () => {
    let calls = 0;
    const { chat } = setup(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('rate limited');
      }
      return JSON.stringify({ answer: 'Now it works.' });
    });

    expect(await chat.ask('Q?')).toBe('failed');
    expect(chat.messages.at(-1)?.text).toMatch(/Couldn't answer that\.\*\* rate limited/);
    expect(chat.canSend).toBe(true);
    expect(await chat.ask('Q again?')).toBe('answered');
  });

  it('adds nothing after being cancelled mid-request', async () => {
    let finish: ((text: string) => void) | undefined;
    const { chat } = setup(() => new Promise<string>((resolve) => (finish = resolve)));
    const listener = vi.fn();
    chat.onDidChange(listener);

    const pending = chat.ask('Q?');
    // Context is built asynchronously before the provider is called.
    await vi.waitFor(() => expect(finish).toBeDefined());
    listener.mockClear();
    chat.cancel();
    finish?.(JSON.stringify({ answer: 'Too late.' }));

    expect(await pending).toBe('failed');
    expect(listener).not.toHaveBeenCalled();
    expect(chat.canSend).toBe(false);
    expect(chat.messages.some((m) => m.text === 'Too late.')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- test/unit/explanationChat.test.ts`
Expected: FAIL with "Cannot find module '../../src/ui/explanationChat'".

- [ ] **Step 3: Export the failure helper from quizRun**

In `src/ui/quizRun.ts`, rename the private helper at the bottom of the file and export it:

```ts
export function failureMarkdown(what: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `😕 **Couldn't ${what}.** ${escapeModelText(message)}\n\nCheck **Patch Tutor: Test connection**, then try again.`;
}
```

Then replace the three call sites `failure('write a quiz', error)` and `failure('check your answer', error)` (in `start` and `submit`) with `failureMarkdown(...)`.

- [ ] **Step 4: Write ExplanationChat**

Create `src/ui/explanationChat.ts`:

```ts
import type { Hunk } from '../git/hunk';
import type { Depth, Explanation } from '../llm/schemas';
import type { HunkContext } from '../services/explainService';
import type { Exchange, FollowUpService } from '../services/followUpService';
import { escapeModelText } from './markdownStyle';
import { failureMarkdown, type QuizMessage } from './quizRun';

export type AskResult = 'answered' | 'empty' | 'not-ready' | 'failed';

const REVISED_NOTE = '✏️ _I corrected the explanation above._';

/**
 * A follow-up conversation about one explanation. Like QuizRun it knows
 * nothing about where it is shown: the comment thread and the chat view are
 * both renderings of `messages`.
 */
export class ExplanationChat {
  private readonly listeners = new Set<() => void>();
  private readonly controller = new AbortController();
  private readonly exchanges: Exchange[] = [];
  /** Built on the first question and reused, so later ones skip language-server lookups. */
  private context: HunkContext | undefined;

  readonly messages: QuizMessage[] = [];
  busy = false;
  /** True once a reply corrected the explanation. */
  revised = false;

  constructor(
    readonly hunk: Hunk,
    readonly repoRoot: string,
    readonly depth: Depth,
    /** The explanation as currently shown, replaced when the tutor revises it. */
    public explanation: Explanation,
    private readonly followUps: FollowUpService,
  ) {}

  get canSend(): boolean {
    return !this.busy && !this.cancelled;
  }

  get cancelled(): boolean {
    return this.controller.signal.aborted;
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async ask(text: string): Promise<AskResult> {
    if (!this.canSend) {
      return 'not-ready';
    }
    const question = text.trim();
    if (!question) {
      return 'empty';
    }

    this.messages.push(
      { from: 'you', text: question },
      { from: 'tutor', text: 'Thinking…', pending: true },
    );
    this.busy = true;
    this.changed();

    let outcome: AskResult = 'answered';
    try {
      const result = await this.followUps.ask({
        hunk: this.hunk,
        repoRoot: this.repoRoot,
        depth: this.depth,
        explanation: this.explanation,
        history: this.exchanges,
        question,
        context: this.context,
        signal: this.controller.signal,
      });
      if (this.cancelled) {
        return 'failed';
      }
      this.context = result.context;
      this.exchanges.push({ question, answer: result.answer });
      if (result.revised) {
        // The thread's depth buttons own depth; a revision only fixes content.
        this.explanation = { ...result.revised, depth: this.depth };
        this.revised = true;
      }
      this.messages.pop();
      this.messages.push({ from: 'tutor', text: answerMarkdown(result.answer, !!result.revised) });
    } catch (error) {
      if (this.cancelled) {
        return 'failed';
      }
      // The question stays visible so it can be asked again.
      this.messages.pop();
      this.messages.push({ from: 'tutor', text: failureMarkdown('answer that', error) });
      outcome = 'failed';
    }
    this.busy = false;
    this.changed();
    return outcome;
  }

  cancel(): void {
    this.controller.abort();
    this.listeners.clear();
  }

  private changed(): void {
    this.listeners.forEach((listener) => listener());
  }
}

function answerMarkdown(answer: string, revised: boolean): string {
  const text = escapeModelText(answer.trim());
  return revised ? `${text}\n\n${REVISED_NOTE}` : text;
}
```

Note: the fake in the cancel test ignores the abort signal and resolves later, which is why `ask` checks `this.cancelled` after the await as well as in `catch`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- test/unit/explanationChat.test.ts test/unit/quizRun.test.ts && npm run typecheck`
Expected: PASS, and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/ui/explanationChat.ts src/ui/quizRun.ts test/unit/explanationChat.test.ts
git commit -m "Add ExplanationChat, a follow-up conversation about one explanation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Follow-ups and Refresh in the comment thread

**Files:**
- Modify: `src/ui/threads.ts`
- Modify: `src/ui/comments.ts`
- Create: `src/ui/followUpThreads.ts`
- Modify: `src/ui/explanationMarkdown.ts`
- Modify: `src/ui/inlineCommands.ts`
- Modify: `src/extension.ts`
- Modify: `package.json` (commands, menus)
- Test: `test/unit/explanationMarkdown.test.ts`, `test/integration/inlineUi.test.ts`

**Interfaces:**
- Consumes: `ExplanationChat` (Task 2); `FollowUpService` (Task 1).
- Produces:
  - `ThreadEntry` gains `explained?: Explanation`, `chat?: ExplanationChat`, `chatInChat?: boolean`.
  - `ThreadRegistry.attachChat(entry: ThreadEntry, chat: ExplanationChat): void`
  - `ThreadRegistry.moveChatToChat(entry: ThreadEntry): ExplanationChat | undefined`
  - `ThreadRegistry.resetChat(entry: ThreadEntry): void`
  - `InlineComments.refresh(thread: vscode.CommentThread): Promise<void>`
  - `class FollowUpThreads { constructor(threads: ThreadRegistry, followUps: FollowUpService); ask(reply: vscode.CommentReply): Promise<void>; moveToChat(thread: vscode.CommentThread): ExplanationChat | undefined }`
  - `explanationMarkdown(explanation: Explanation, fromCache: boolean, revised?: boolean): string`
  - `registerInlineCommands(..., followUps: FollowUpThreads)` (new last parameter)
  - Thread `contextValue`: `patchTutorThread <depth>` + one of `' quiz'` (quiz waiting), `' chat'` (can ask, nothing asked yet), `' chat started'` (can ask, has messages), or nothing.

- [ ] **Step 1: Write the failing unit test for the markdown change**

Add to `test/unit/explanationMarkdown.test.ts`, inside its `describe` block (it already defines `const explanation: Explanation` at the top):

```ts
  it('marks a revised explanation and invites questions', () => {
    const md = explanationMarkdown(explanation, false, true);
    expect(md).toContain('✏️ Revised after your reply');
    expect(md).toContain('reply below');
    expect(explanationMarkdown(explanation, false)).not.toContain('Revised');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/unit/explanationMarkdown.test.ts`
Expected: FAIL on `toContain('✏️ Revised after your reply')`.

- [ ] **Step 3: Update explanationMarkdown**

In `src/ui/explanationMarkdown.ts`, change the signature and the last two `parts` lines:

```ts
export function explanationMarkdown(
  explanation: Explanation,
  fromCache: boolean,
  revised = false,
): string {
```

```ts
  const meta = [
    DEPTH_LABEL[explanation.depth],
    revised ? '✏️ Revised after your reply' : undefined,
    fromCache ? '⚡ from cache' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
  parts.push(
    `---\n🎓 **Think you've got it?** Hit **Quiz me** above, or reply below with a question. · _${meta}_`,
  );
```

Run: `npm test -- test/unit/explanationMarkdown.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing integration test**

In `test/integration/inlineUi.test.ts`:

1. Next to `const requests: string[] = [];` add:

```ts
  let followUpReply: object = { answer: 'Because arrays know their length.' };
```

2. In the fake provider's `complete`, before `return JSON.stringify(EXPLANATION);`, add:

```ts
        if (request.system.includes('follow-up question')) {
          return JSON.stringify(followUpReply);
        }
```

3. In the test 'Explain opens a comment thread on the hunk with the explanation', change
`assert.strictEqual(thread.contextValue, 'patchTutorThread standard');` to
`assert.strictEqual(thread.contextValue, 'patchTutorThread standard chat');`

4. The test 'Quiz me asks questions one at a time…' defines a local `bodies` helper. Move it to module scope (delete the local `const bodies = …` and add this near the top, after the constants) so the new tests can use it:

```ts
function bodies(thread: vscode.CommentThread): string[] {
  return thread.comments.map((c) => (c.body instanceof vscode.MarkdownString ? c.body.value : c.body));
}
```

5. In that same quiz test, the thread was explained first, so once the quiz is done the reply box goes back to follow-ups. Change

```ts
    assert.strictEqual(thread.canReply, false);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard');
```

(right after the `Quiz done!` assertion) to

```ts
    // Once the quiz is done, the reply box asks follow-ups about the explanation again.
    assert.strictEqual(thread.canReply, true);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard chat');
```

The 'Move to chat continues the same quiz…' test is unaffected: its thread has no explanation, so it never offers follow-ups.

6. Add this test after the 'Explain opens a comment thread…' test:

```ts
  test('Replying asks a follow-up; a correction revises the explanation; Refresh starts over', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const hunk = (await api.hunks.getHunks(document))?.hunks.find((h) =>
      h.added.includes(ADDED_LINE),
    );
    assert.ok(hunk);
    await vscode.commands.executeCommand('patchTutor.explainHunk', file, hunk.id);
    const [thread] = api.threads.threadsFor(file);
    assert.ok(thread);
    assert.strictEqual(thread.canReply, true);

    followUpReply = { answer: 'Because arrays know their `length`.' };
    await vscode.commands.executeCommand('patchTutor.chat.ask', { thread, text: 'Why length?' });
    assert.match(bodies(thread).at(-2) ?? '', /Why length\?/);
    assert.match(bodies(thread).at(-1) ?? '', /arrays know their/);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard chat started');
    assert.match(requests.at(-1) ?? '', /Why length\?/);

    followUpReply = {
      answer: 'You are right.',
      revised: { ...EXPLANATION, summary: 'Counts items in one pass.' },
    };
    await vscode.commands.executeCommand('patchTutor.chat.ask', { thread, text: 'Really?' });
    assert.match(bodies(thread)[0] ?? '', /Revised after your reply/);
    assert.match(bodies(thread)[0] ?? '', /Counts items in one pass/);
    assert.strictEqual(thread.label, '💡 Counts items in one pass.');
    assert.match(requests.at(-1) ?? '', /Developer: Why length\?/);

    // A quiz waiting for an answer owns the reply box.
    await vscode.commands.executeCommand('patchTutor.thread.quiz', thread);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard quiz');

    await vscode.commands.executeCommand('patchTutor.thread.refresh', thread);
    assert.doesNotMatch(bodies(thread)[0] ?? '', /Revised/);
    assert.match(bodies(thread)[0] ?? '', /Counts the items\./);
    assert.ok(!bodies(thread).some((b) => /Why length/.test(b)), 'conversation cleared');

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
  });
```

Note: Refresh keeps the quiz (it only regenerates the explanation and clears the chat), so the final assertions check the explanation and the absence of chat messages rather than the comment count.

- [ ] **Step 5: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL. The first failure is the changed `contextValue` assertion ('patchTutorThread standard' vs '… chat'), and the new test fails because `patchTutor.chat.ask` is not registered.

- [ ] **Step 6: Extend ThreadRegistry**

In `src/ui/threads.ts`:

Add imports:

```ts
import type { Depth, Explanation } from '../llm/schemas';
import type { ExplanationChat } from './explanationChat';
```

(replace the existing `import type { Depth } from '../llm/schemas';`).

Add to `ThreadEntry`:

```ts
  /** The explanation shown, when it parsed; follow-up chat needs it. */
  explained?: Explanation;
  chat?: ExplanationChat;
  /** Set when the chat was moved to the chat view; the thread then shows a pointer instead. */
  chatInChat?: boolean;
```

Add next to `MOVED_TO_CHAT`:

```ts
const CHAT_MOVED_TO_CHAT =
  '💬 **This conversation continues in the Patch Tutor chat** in the sidebar.';
```

Change the controller options in the constructor:

```ts
    this.controller.options = {
      prompt: 'Answer the quiz or ask a follow-up…',
      placeHolder: 'Ask about this change, or answer the quiz question.',
    };
```

Replace `render` with:

```ts
  /** Writes an entry's comments, title, buttons and reply box to its thread. */
  render(entry: ThreadEntry): void {
    const { thread, quiz, chat } = entry;
    const inThread = !!quiz && !entry.quizInChat;
    // " quiz" enables Move to chat and the reply-box buttons while a quiz is in progress here.
    const active = inThread && !quiz.done;
    let quizComments: vscode.Comment[] = [];
    if (quiz) {
      quizComments = inThread
        ? quiz.messages.map((m) => this.messageComment(m))
        : [this.tutorComment(MOVED_TO_CHAT)];
    }
    let chatComments: vscode.Comment[] = [];
    if (chat) {
      chatComments = entry.chatInChat
        ? [this.tutorComment(CHAT_MOVED_TO_CHAT)]
        : chat.messages.map((m) => this.messageComment(m));
    }
    // Follow-ups need a parsed explanation, and wait while a quiz is taking answers here.
    const canChat = !!entry.explained && !active && !entry.chatInChat;
    let mode = '';
    if (active) {
      mode = ' quiz';
    } else if (canChat) {
      mode = chat && chat.messages.length > 0 ? ' chat started' : ' chat';
    }
    thread.label = entry.title;
    thread.comments = [
      ...(entry.explanation ? [entry.explanation] : []),
      ...chatComments,
      ...quizComments,
      ...(entry.notes ?? []),
    ];
    thread.contextValue = `patchTutorThread ${entry.depth}${mode}`;
    thread.canReply = active ? quiz.canAnswer : canChat && !chat?.busy;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }
```

Add after `moveQuizToChat`:

```ts
  /** Points an entry at a new follow-up chat, re-rendering whenever it changes. */
  attachChat(entry: ThreadEntry, chat: ExplanationChat): void {
    this.resetChat(entry);
    entry.chat = chat;
    chat.onDidChange(() => {
      if (entry.chat === chat) {
        this.render(entry);
      }
    });
    this.render(entry);
  }

  /** Hands the entry's chat to the chat view; the thread keeps a pointer to it. */
  moveChatToChat(entry: ThreadEntry): ExplanationChat | undefined {
    if (!entry.chat || entry.chatInChat || entry.chat.messages.length === 0) {
      return undefined;
    }
    entry.chatInChat = true;
    this.render(entry);
    return entry.chat;
  }

  /** Drops the entry's chat; one that moved to the chat view keeps going there. */
  resetChat(entry: ThreadEntry): void {
    if (entry.chat && !entry.chatInChat) {
      entry.chat.cancel();
    }
    entry.chat = undefined;
    entry.chatInChat = false;
  }
```

In `close`, after the quiz cancel block, add:

```ts
        if (!entry.chatInChat) {
          entry.chat?.cancel();
        }
```

In `dispose`, inside the `forEach`, add the same two lines (using `e`):

```ts
      if (!e.chatInChat) {
        e.chat?.cancel();
      }
```

- [ ] **Step 7: Reset the chat on (re-)explain and add refresh**

In `src/ui/comments.ts`:

Change `render`'s signature and its start, and store the parsed explanation:

```ts
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
```

Pass `skipCache` to the service:

```ts
          this.explainService.explainHunk(entry.hunk, depth, {
            signal: controller.signal,
            repoRoot: entry.repoRoot,
            skipCache,
          }),
```

In the success branch, add `entry.explained = result.explanation;` after setting `entry.title`.

- [ ] **Step 8: Add FollowUpThreads**

Create `src/ui/followUpThreads.ts`:

```ts
import * as vscode from 'vscode';
import type { Explanation } from '../llm/schemas';
import type { FollowUpService } from '../services/followUpService';
import { ExplanationChat } from './explanationChat';
import { explanationMarkdown, threadTitle } from './explanationMarkdown';
import type { ThreadEntry, ThreadRegistry } from './threads';

/**
 * Routes the thread's reply box to a follow-up chat about the explanation,
 * and shows the tutor's corrections in the explanation itself.
 */
export class FollowUpThreads {
  constructor(
    private readonly threads: ThreadRegistry,
    private readonly followUps: FollowUpService,
  ) {}

  async ask(reply: vscode.CommentReply): Promise<void> {
    const entry = this.threads.find(reply.thread);
    if (!entry?.explained || entry.chatInChat) {
      return;
    }
    const chat = entry.chat ?? this.startChat(entry, entry.explained);
    if ((await chat.ask(reply.text)) === 'empty') {
      void vscode.window.showInformationMessage('Patch Tutor: Type a question first.');
    }
  }

  moveToChat(thread: vscode.CommentThread): ExplanationChat | undefined {
    const entry = this.threads.find(thread);
    return entry && this.threads.moveChatToChat(entry);
  }

  private startChat(entry: ThreadEntry, explanation: Explanation): ExplanationChat {
    const chat = new ExplanationChat(
      entry.hunk,
      entry.repoRoot,
      entry.depth,
      explanation,
      this.followUps,
    );
    // Registered before attachChat's listener, so the re-render shows the correction.
    chat.onDidChange(() => {
      if (chat.revised && entry.chat === chat) {
        entry.explained = chat.explanation;
        entry.explanation = this.threads.tutorComment(
          explanationMarkdown(chat.explanation, false, true),
        );
        entry.title = threadTitle(chat.explanation);
      }
    });
    this.threads.attachChat(entry, chat);
    return chat;
  }
}
```

- [ ] **Step 9: Register the commands**

In `src/ui/inlineCommands.ts`:

Add `import type { FollowUpThreads } from './followUpThreads';` and a new last parameter `followUps: FollowUpThreads` to `registerInlineCommands`.

Add inside `context.subscriptions.push(` (next to `patchTutor.thread.dismiss`):

```ts
    vscode.commands.registerCommand('patchTutor.thread.refresh', (thread: vscode.CommentThread) =>
      comments.refresh(thread),
    ),
    vscode.commands.registerCommand('patchTutor.chat.ask', (reply: vscode.CommentReply) =>
      followUps.ask(reply),
    ),
```

In `src/extension.ts`:

Add imports:

```ts
import { FollowUpService } from './services/followUpService';
import { FollowUpThreads } from './ui/followUpThreads';
```

After `const comments = new InlineComments(threads, explainService);` add:

```ts
  const followUps = new FollowUpThreads(
    threads,
    new FollowUpService({ createProvider: provider, buildContext, maxOutputTokens }),
  );
```

Pass `followUps` as the new last argument of `registerInlineCommands(...)` (after `modelKey`).

- [ ] **Step 10: Contribute the commands and menus**

In `package.json` `contributes.commands`, add:

```json
      {
        "command": "patchTutor.thread.refresh",
        "title": "Refresh explanation",
        "category": "Patch Tutor",
        "icon": "$(refresh)"
      },
      {
        "command": "patchTutor.chat.ask",
        "title": "Ask",
        "category": "Patch Tutor"
      },
```

In `menus.commandPalette`, add:

```json
        {
          "command": "patchTutor.thread.refresh",
          "when": "false"
        },
        {
          "command": "patchTutor.chat.ask",
          "when": "false"
        },
```

Replace the whole `comments/commentThread/title` array with (refresh added at `inline@3`, later groups renumbered):

```json
      "comments/commentThread/title": [
        {
          "command": "patchTutor.thread.simpler",
          "group": "inline@1",
          "when": "commentController == patch-tutor && commentThread =~ /^patchTutorThread (standard|deep)\\b/"
        },
        {
          "command": "patchTutor.thread.deeper",
          "group": "inline@2",
          "when": "commentController == patch-tutor && commentThread =~ /^patchTutorThread (simple|standard)\\b/"
        },
        {
          "command": "patchTutor.thread.refresh",
          "group": "inline@3",
          "when": "commentController == patch-tutor && commentThread =~ /^patchTutorThread/"
        },
        {
          "command": "patchTutor.thread.quiz",
          "group": "inline@4",
          "when": "commentController == patch-tutor && commentThread =~ /^patchTutorThread/"
        },
        {
          "command": "patchTutor.quiz.moveToChat",
          "when": "commentController == patch-tutor && commentThread =~ /\\bquiz$/",
          "group": "inline@5"
        },
        {
          "command": "patchTutor.thread.reportWrong",
          "group": "inline@7",
          "when": "commentController == patch-tutor && commentThread =~ /^patchTutorThread/"
        },
        {
          "command": "patchTutor.thread.dismiss",
          "group": "inline@8",
          "when": "commentController == patch-tutor && commentThread =~ /^patchTutorThread/"
        }
      ],
```

(`inline@6` is reserved for the chat's Move to chat button in Task 4.)

In `comments/commentThread/context`, add at the end:

```json
        {
          "command": "patchTutor.chat.ask",
          "group": "inline@1",
          "when": "commentController == patch-tutor && commentThread =~ / chat( started)?$/"
        }
```

- [ ] **Step 11: Run all tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: all PASS.

- [ ] **Step 12: Commit**

```bash
git add src/ui/threads.ts src/ui/comments.ts src/ui/followUpThreads.ts src/ui/explanationMarkdown.ts src/ui/inlineCommands.ts src/extension.ts package.json test/unit/explanationMarkdown.test.ts test/integration/inlineUi.test.ts
git commit -m "Let users reply to explanations, and add a Refresh button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Continue a follow-up in the sidebar chat

**Files:**
- Modify: `src/ui/chat/chatView.ts`
- Modify: `src/ui/chat/chatHtml.ts`
- Modify: `src/ui/inlineCommands.ts`
- Modify: `package.json`
- Test: `test/unit/chatFollowUp.test.ts`, `test/integration/inlineUi.test.ts`

**Interfaces:**
- Consumes: `ExplanationChat` (Task 2); `FollowUpThreads.moveToChat` (Task 3).
- Produces:
  - `QuizPanel` gains `kind: 'quiz' | 'followUp'`.
  - `type LiveConversation = QuizRun | ExplanationChat` exported from `src/ui/chat/chatView.ts`.
  - `ChatView.adopt(conversation: LiveConversation, uri: vscode.Uri): Promise<void>`; `ChatView.current: LiveConversation | undefined`; `ChatView.submit(text)` routes to `QuizRun.submit` or `ExplanationChat.ask`.
  - Command `patchTutor.chat.moveToChat`.

- [ ] **Step 1: Write the failing webview test**

Create `test/unit/chatFollowUp.test.ts`:

```ts
// @vitest-environment happy-dom
import type { Window as DomWindow, HTMLButtonElement, HTMLTextAreaElement } from 'happy-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { chatShellHtml, type ChatState, type QuizPanel } from '../../src/ui/chat/chatHtml';

// DOM types come from happy-dom so the project itself stays without the DOM lib.
const window = globalThis as unknown as DomWindow;
const document = window.document;
const posted: Record<string, unknown>[] = [];

const panel = (kind: QuizPanel['kind']): QuizPanel => ({
  kind,
  file: 'src/cart.js',
  line: 12,
  messages: [{ from: 'tutor', html: '<p>TL;DR</p>' }],
  canAnswer: true,
  busy: false,
  done: false,
});

const state = (quiz: QuizPanel): ChatState => ({
  tab: 'quiz',
  modelLabel: 'Fake',
  quiz,
  history: [],
  settings: { active: { provider: 'vscodeLm', model: '', baseUrl: '' }, providers: [], presets: [], version: 1 },
});

function send(data: unknown): void {
  window.dispatchEvent(new window.MessageEvent('message', { data }));
}

const $ = <T>(id: string) => document.getElementById(id) as unknown as T;

/** Loads the real page and runs its script against a fake VS Code API. */
function openChat(quiz: QuizPanel): void {
  const html = chatShellHtml({ nonce: 'n', cspSource: 's', avatarUri: 'a' });
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';
  const script = document.querySelector('script')?.textContent ?? '';
  document.querySelector('script')?.remove();
  Object.assign(globalThis, {
    acquireVsCodeApi: () => ({ postMessage: (m: Record<string, unknown>) => posted.push(m) }),
  });
  new Function(script)();
  send({ type: 'state', state: state(quiz) });
}

beforeEach(() => {
  posted.length = 0;
});

describe('chat view follow-ups', () => {
  it('shows a follow-up without the quiz-only buttons and sends messages', () => {
    openChat(panel('followUp'));

    expect($<HTMLButtonElement>('bar').textContent).toContain('Follow-up on');
    expect($<HTMLButtonElement>('reveal').hidden).toBe(true);
    expect($<HTMLButtonElement>('skip').hidden).toBe(true);
    expect($<HTMLButtonElement>('submit').textContent).toBe('Send');
    expect($<HTMLTextAreaElement>('answer').placeholder).toMatch(/Ask a question or push back/);

    $<HTMLTextAreaElement>('answer').value = 'Why count()?';
    $<HTMLButtonElement>('submit').click();
    expect(posted.at(-1)).toEqual({ action: 'submit', text: 'Why count()?' });
  });

  it('brings the quiz buttons back for a quiz', () => {
    openChat(panel('followUp'));
    send({ type: 'state', state: state(panel('quiz')) });

    expect($<HTMLButtonElement>('bar').textContent).toContain('Quiz on');
    expect($<HTMLButtonElement>('reveal').hidden).toBe(false);
    expect($<HTMLButtonElement>('skip').hidden).toBe(false);
    expect($<HTMLButtonElement>('submit').textContent).toBe('Submit');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- test/unit/chatFollowUp.test.ts`
Expected: FAIL. Typecheck of `kind` aside (Vitest doesn't typecheck), the first assertion fails because the bar says "Quiz on".

- [ ] **Step 3: Update the chat page**

In `src/ui/chat/chatHtml.ts`:

Add to `QuizPanel`:

```ts
export interface QuizPanel {
  /** A quiz, or a follow-up chat about an explanation. */
  kind: 'quiz' | 'followUp';
```

Rename the tab label and the empty state in the markup:

```html
  <button role="tab" data-action="tab" data-tab="quiz" id="tab-quiz">Chat</button>
```

```html
<section id="empty" class="empty" hidden>
  <p class="empty-title">Nothing in progress</p>
  <p class="hint">Click <strong>Quiz me</strong> above a change, or reply to an explanation, then <strong>Move to chat</strong>.</p>
  <p><button class="link" data-action="tab" data-tab="history">View past quizzes</button></p>
</section>
```

In `SCRIPT`, after `let state;` add:

```js
const QUIZ_PLACEHOLDER = 'Type your answer. Short is fine. Enter to send, Shift+Enter for a new line.';
const FOLLOW_UP_PLACEHOLDER = 'Ask a question or push back. Enter to send, Shift+Enter for a new line.';
```

Replace the body of the `if (state.tab === 'quiz') { … }` block with:

```js
    const quiz = state.quiz;
    if (!quiz) { show('empty', true); return; }
    const followUp = quiz.kind === 'followUp';
    bar.innerHTML = '';
    bar.append(followUp ? '💬 Follow-up on ' : '🎓 Quiz on ');
    const where = document.createElement('button');
    where.className = 'link';
    where.dataset.action = 'showChange';
    where.textContent = quiz.file + ':' + quiz.line;
    bar.append(where);
    show('bar', true);
    show('messages', true);
    renderMessages(quiz.messages, switched || quiz.busy);
    show('composer', !quiz.done);
    show('finished', quiz.done);
    show('reveal', !followUp);
    show('skip', !followUp);
    $('submit').textContent = followUp ? 'Send' : 'Submit';
    answer.placeholder = followUp ? FOLLOW_UP_PLACEHOLDER : QUIZ_PLACEHOLDER;
    for (const id of ['submit', 'reveal', 'skip']) $(id).disabled = !quiz.canAnswer;
    if (quiz.canAnswer && document.activeElement !== answer) answer.focus();
    return;
```

(`SCRIPT` is a template literal: the code above contains no backticks or `${`, keep it that way.)

Run: `npm test -- test/unit/chatFollowUp.test.ts test/unit/chatSettings.test.ts`
Expected: PASS.

- [ ] **Step 4: Generalize ChatView**

In `src/ui/chat/chatView.ts`:

Replace `import type { QuizRun } from '../quizRun';` with:

```ts
import type { ExplanationChat } from '../explanationChat';
import { escapeModelText } from '../markdownStyle';
import { QuizRun, type QuizMessage } from '../quizRun';
```

Add `type QuizPanel` to the `./chatHtml` import list, and below `CHAT_VIEW_ID`:

```ts
/** What the Chat tab can show: a quiz, or a follow-up chat about an explanation. */
export type LiveConversation = QuizRun | ExplanationChat;
```

Rename the field `private quiz: QuizRun | undefined;` to `private live: LiveConversation | undefined;` and `quizSubscription` to `liveSubscription`, then update every use:

```ts
  /** The live conversation; exposed for tests. */
  get current(): LiveConversation | undefined {
    return this.live;
  }
```

```ts
  /** Shows a quiz or follow-up on the Chat tab, replacing any previous one, and reveals the chat. */
  async adopt(conversation: LiveConversation, uri: vscode.Uri): Promise<void> {
    if (this.live && this.live !== conversation) {
      this.live.cancel();
    }
    this.liveSubscription?.dispose();
    this.live = conversation;
    this.uri = uri;
    this.tab = 'quiz';
    this.viewing = undefined;
    this.liveSubscription = conversation.onDidChange(() => this.post());
    this.post();
    await vscode.commands.executeCommand(`${CHAT_VIEW_ID}.focus`);
  }

  async submit(text: string): Promise<void> {
    if (this.live instanceof QuizRun) {
      await this.live.submit(text);
    } else {
      await this.live?.ask(text);
    }
  }

  async anotherRound(): Promise<void> {
    if (!(this.live instanceof QuizRun) || !this.uri) {
      return;
    }
    const next = this.newRound(this.live);
    await this.adopt(next, this.uri);
    await next.start();
  }
```

In `state()`, replace `const quiz = this.quiz;` and the `quiz:` and `history:` properties with:

```ts
    const live = this.live;
    const quizId = live instanceof QuizRun ? live.id : undefined;
```

```ts
      quiz: live && livePanel(live),
      history: this.history.map((t) => historyItem(t, now, quizId)),
```

In `dispose()`: `this.liveSubscription?.dispose();` and `this.live?.cancel();`.

In `handle()`: the `'ready'` case uses `!this.live`; the `'skip'` and `'reveal'` cases become:

```ts
      case 'skip':
        if (this.live instanceof QuizRun) {
          this.live.skip();
        }
        break;
      case 'reveal':
        if (this.live instanceof QuizRun) {
          this.live.reveal();
        }
        break;
```

In `showChange()`: replace `this.quiz` with `this.live` (both `hunk` uses work for either type).

Add at the bottom of the file:

```ts
function livePanel(live: LiveConversation): QuizPanel {
  const where = { file: live.hunk.filePath, line: changedLineRange(live.hunk).start };
  if (live instanceof QuizRun) {
    return {
      kind: 'quiz',
      ...where,
      messages: live.messages.map(messageHtml),
      canAnswer: live.canAnswer,
      busy: live.busy,
      done: live.done,
    };
  }
  // Pin what the conversation is about, since the explanation stays in the editor.
  const pinned: QuizMessage = {
    from: 'tutor',
    text: `> 💡 **TL;DR:** ${escapeModelText(live.explanation.summary)}`,
  };
  return {
    kind: 'followUp',
    ...where,
    messages: [pinned, ...live.messages].map(messageHtml),
    canAnswer: live.canSend,
    busy: live.busy,
    done: false,
  };
}
```

- [ ] **Step 5: Add the move command and menus**

In `src/ui/inlineCommands.ts`, inside `context.subscriptions.push(` after `patchTutor.quiz.moveToChat`:

```ts
    // From the reply box the argument is a CommentReply; from the title bar, the thread.
    vscode.commands.registerCommand(
      'patchTutor.chat.moveToChat',
      async (target: vscode.CommentReply | vscode.CommentThread) => {
        const thread = 'thread' in target ? target.thread : target;
        const conversation = followUps.moveToChat(thread);
        if (conversation) {
          await chat.adopt(conversation, thread.uri);
        }
      },
    ),
```

In `package.json`:

`contributes.commands`:

```json
      {
        "command": "patchTutor.chat.moveToChat",
        "title": "Move to chat",
        "category": "Patch Tutor",
        "icon": "$(comment-discussion)"
      },
```

`menus.commandPalette`:

```json
        {
          "command": "patchTutor.chat.moveToChat",
          "when": "false"
        },
```

`comments/commentThread/title` (fills the reserved slot):

```json
        {
          "command": "patchTutor.chat.moveToChat",
          "group": "inline@6",
          "when": "commentController == patch-tutor && commentThread =~ / chat started$/"
        },
```

`comments/commentThread/context`:

```json
        {
          "command": "patchTutor.chat.moveToChat",
          "group": "inline@2",
          "when": "commentController == patch-tutor && commentThread =~ / chat started$/"
        }
```

- [ ] **Step 6: Write the integration test and fix the union type in the existing one**

In `test/integration/inlineUi.test.ts`, in 'Move to chat continues the same quiz in the sidebar chat', change

```ts
    const quiz = api.chat.current;
    assert.ok(quiz);
```

to

```ts
    const quiz = api.chat.current;
    assert.ok(quiz && 'reveal' in quiz, 'expected a quiz');
```

and add `assert.strictEqual(state.quiz?.kind, 'quiz');` after `assert.strictEqual(state.tab, 'quiz');`.

Add a new test after it:

```ts
  test('Move to chat continues a follow-up in the sidebar chat', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const hunk = (await api.hunks.getHunks(document))?.hunks.find((h) =>
      h.added.includes(ADDED_LINE),
    );
    assert.ok(hunk);
    await vscode.commands.executeCommand('patchTutor.explainHunk', file, hunk.id);
    const [thread] = api.threads.threadsFor(file);
    assert.ok(thread);
    followUpReply = { answer: 'First answer.' };
    await vscode.commands.executeCommand('patchTutor.chat.ask', { thread, text: 'First?' });

    await vscode.commands.executeCommand('patchTutor.chat.moveToChat', { thread, text: '' });

    assert.match(bodies(thread).at(-1) ?? '', /conversation continues in the Patch Tutor chat/);
    assert.strictEqual(thread.canReply, false);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard');
    const state = api.chat.state();
    assert.strictEqual(state.quiz?.kind, 'followUp');
    assert.match(state.quiz?.messages[0]?.html ?? '', /TL;DR/);
    assert.deepStrictEqual(
      state.quiz?.messages.map((m) => m.from),
      ['tutor', 'you', 'tutor'],
    );

    followUpReply = { answer: 'Second answer.' };
    await api.chat.submit('Second?');
    assert.match(api.chat.state().quiz?.messages.at(-1)?.html ?? '', /Second answer/);

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
  });
```

- [ ] **Step 7: Run all tests**

Run: `npm run typecheck && npm test && npm run test:integration`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/ui/chat/chatView.ts src/ui/chat/chatHtml.ts src/ui/inlineCommands.ts package.json test/unit/chatFollowUp.test.ts test/integration/inlineUi.test.ts
git commit -m "Move a follow-up conversation to the sidebar chat

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Follow-up prompt evals

**Files:**
- Create: `test/fixtures/followups/count-query.diff`
- Create: `test/fixtures/followups/correct-pushback.json`
- Create: `test/fixtures/followups/wrong-pushback.json`
- Create: `src/dev/followUpEvals.ts`
- Modify: `src/extension.ts` (`registerDevCommands`)
- Modify: `package.json` (dev command)
- Test: `test/unit/followUpFixtures.test.ts`

**Interfaces:**
- Consumes: `FollowUpService` (Task 1); `fixtureContext` (`src/dev/promptEvals.ts`); `parseUnifiedDiff`; `ExplanationSchema`.
- Produces: `FollowUpFixtureSchema` and `runFollowUpEvals(extensionUri: vscode.Uri, service: FollowUpService, modelKey: string): Promise<void>`; command `patchTutor.dev.runFollowUpEvals`.

- [ ] **Step 1: Write the fixtures**

Create `test/fixtures/followups/count-query.diff` (spaces exactly as shown; every context line starts with one space):

```diff
diff --git a/src/bootstrap.js b/src/bootstrap.js
index 1111111..2222222 100644
--- a/src/bootstrap.js
+++ b/src/bootstrap.js
@@ -1,8 +1,9 @@
 async function grantPublicRead(strapi, roleId, actions) {
+  const permissions = strapi.db.query('plugin::users-permissions.permission');
   for (const action of actions) {
-    const existing = await strapi.db.query('plugin::users-permissions.permission').findMany({ where: { action, role: roleId } });
-    if (existing.length === 0) {
-      await strapi.db.query('plugin::users-permissions.permission').create({ data: { action, role: roleId } });
+    const count = await permissions.count({ where: { action, role: roleId } });
+    if (count === 0) {
+      await permissions.create({ data: { action, role: roleId } });
     }
   }
 }
```

Create `test/fixtures/followups/correct-pushback.json` (the explanation repeats the real mistake that prompted this feature):

```json
{
  "diff": "count-query.diff",
  "explanation": {
    "summary": "Uses count() instead of findMany() to check for existing permissions.",
    "whatChanged": "The existence check now calls `count()` instead of `findMany()`, and the query handle is stored in `permissions`.",
    "howItWorks": "`count()` returns a number, so the code checks `count === 0` before creating the permission.",
    "whyItWorks": "This reduces the number of database calls, because counting avoids loading rows.",
    "concepts": ["orm", "performance"],
    "risks": [],
    "depth": "standard"
  },
  "message": "Does it really reduce the number of database calls? It still looks like one query per action, plus a create for each missing one.",
  "expectRevised": true
}
```

Create `test/fixtures/followups/wrong-pushback.json`:

```json
{
  "diff": "count-query.diff",
  "explanation": {
    "summary": "Uses count() instead of findMany() to check for existing permissions.",
    "whatChanged": "The existence check now calls `count()` instead of `findMany()`, and the query handle is stored in `permissions`.",
    "howItWorks": "`count()` returns a number, so the code checks `count === 0` before creating the permission.",
    "whyItWorks": "Each check returns a number instead of whole rows, so less data moves; the number of queries stays the same.",
    "concepts": ["orm", "performance"],
    "risks": [],
    "depth": "standard"
  },
  "message": "Storing the query in `permissions` means it only queries the database once now, right? So this cuts the queries down to one.",
  "expectRevised": false
}
```

- [ ] **Step 2: Write the failing fixture test**

Create `test/unit/followUpFixtures.test.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FollowUpFixtureSchema } from '../../src/dev/followUpEvals';
import { parseUnifiedDiff } from '../../src/git/diffParser';

const dir = join(__dirname, '..', 'fixtures', 'followups');
const fixtures = readdirSync(dir).filter((name) => name.endsWith('.json'));

describe('follow-up eval fixtures', () => {
  it('has at least one revision case and one hold-your-ground case', () => {
    const expected = fixtures.map(
      (name) => FollowUpFixtureSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8'))).expectRevised,
    );
    expect(expected).toContain(true);
    expect(expected).toContain(false);
  });

  it.each(fixtures)('%s is valid and its diff has exactly one hunk', (name) => {
    const fixture = FollowUpFixtureSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    const hunks = parseUnifiedDiff(readFileSync(join(dir, fixture.diff), 'utf8'));
    expect(hunks).toHaveLength(1);
  });
});
```

`src/dev/followUpEvals.ts` imports `vscode`, which Vitest aliases to `test/unit/mocks/vscode.ts`. The eval module only touches `vscode` inside `runFollowUpEvals`, so importing the schema is safe with the mock.

Run: `npm test -- test/unit/followUpFixtures.test.ts`
Expected: FAIL with "Cannot find module '../../src/dev/followUpEvals'".

- [ ] **Step 3: Write the eval runner**

Create `src/dev/followUpEvals.ts`:

```ts
import * as vscode from 'vscode';
import { z } from 'zod';
import { parseUnifiedDiff } from '../git/diffParser';
import { ExplanationSchema } from '../llm/schemas';
import type { FollowUpService } from '../services/followUpService';
import { fixtureContext } from './promptEvals';

export const FollowUpFixtureSchema = z.object({
  /** A .diff file next to the fixture, with exactly one hunk. */
  diff: z.string().min(1),
  explanation: ExplanationSchema,
  message: z.string().min(1),
  /** Whether a good tutor corrects the explanation in reply to `message`. */
  expectRevised: z.boolean(),
});

/**
 * Development-only: sends each follow-up fixture to the configured provider
 * and reports whether the tutor revised the explanation when it should, and
 * held its ground when it should not.
 */
export async function runFollowUpEvals(
  extensionUri: vscode.Uri,
  service: FollowUpService,
  modelKey: string,
): Promise<void> {
  const dir = vscode.Uri.joinPath(extensionUri, 'test', 'fixtures', 'followups');
  const read = async (name: string) =>
    new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name)));
  const names = (await vscode.workspace.fs.readDirectory(dir))
    .map(([name]) => name)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const report = [
    '# Follow-up prompt eval',
    '',
    `- Model: \`${modelKey}\``,
    `- Run at: ${new Date().toISOString()}`,
  ];
  let passed = 0;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Follow-up evals', cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      for (const name of names) {
        if (controller.signal.aborted) {
          return;
        }
        progress.report({ message: name });
        const fixture = FollowUpFixtureSchema.parse(JSON.parse(await read(name)));
        const [hunk] = parseUnifiedDiff(await read(fixture.diff));
        if (!hunk) {
          report.push('', `## ${name}`, '', '_No hunk in the diff._');
          continue;
        }
        const result = await service.ask({
          hunk,
          repoRoot: undefined,
          depth: fixture.explanation.depth,
          explanation: fixture.explanation,
          history: [],
          question: fixture.message,
          context: await fixtureContext(hunk),
          signal: controller.signal,
        });
        const ok = !!result.revised === fixture.expectRevised;
        passed += ok ? 1 : 0;
        report.push(
          '',
          `## ${ok ? '✅' : '❌'} ${name}`,
          '',
          `**Message:** ${fixture.message}`,
          '',
          `**Expected revision:** ${fixture.expectRevised ? 'yes' : 'no'} · **Got:** ${result.revised ? 'yes' : 'no'}${result.structured ? '' : ' (reply was not valid JSON)'}`,
          '',
          `**Answer:** ${result.answer}`,
          ...(result.revised ? ['', `**Revised why it works:** ${result.revised.whyItWorks}`] : []),
        );
      }
    },
  );

  report.splice(4, 0, `- Passed: ${passed}/${names.length}`);
  const outDir = vscode.Uri.joinPath(extensionUri, 'evals', 'output');
  await vscode.workspace.fs.createDirectory(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = vscode.Uri.joinPath(outDir, `follow-up-${stamp}.md`);
  await vscode.workspace.fs.writeFile(outFile, new TextEncoder().encode(report.join('\n') + '\n'));
  await vscode.window.showTextDocument(outFile, { preview: false });
}
```

Run: `npm test -- test/unit/followUpFixtures.test.ts`
Expected: PASS (3 tests). If the diff fixture reports 0 hunks, check that context lines start with a single space and the file ends with a newline.

- [ ] **Step 4: Register the dev command**

In `src/extension.ts`, add `import { runFollowUpEvals } from './dev/followUpEvals';`, and in `registerDevCommands` add after `evalService`:

```ts
  const followUpEvalService = new FollowUpService({
    createProvider: provider,
    buildContext: fixtureContext,
    maxOutputTokens: () => config().get<number>('maxOutputTokens', 1200),
  });
```

and inside its `context.subscriptions.push(`:

```ts
    vscode.commands.registerCommand('patchTutor.dev.runFollowUpEvals', () =>
      runFollowUpEvals(context.extensionUri, followUpEvalService, modelKey()),
    ),
```

In `package.json` `contributes.commands`:

```json
      {
        "command": "patchTutor.dev.runFollowUpEvals",
        "title": "Run follow-up evals (dev)",
        "category": "Patch Tutor"
      },
```

and in `menus.commandPalette`:

```json
        {
          "command": "patchTutor.dev.runFollowUpEvals",
          "when": "patchTutor.devMode"
        },
```

- [ ] **Step 5: Run all checks**

Run: `npm run typecheck && npm test && npm run build`
Expected: all PASS; the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/followups src/dev/followUpEvals.ts src/extension.ts package.json test/unit/followUpFixtures.test.ts
git commit -m "Add follow-up prompt evals for correct and incorrect pushback

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Manual check (report the result; do not block on it)**

In the Extension Development Host, run **Patch Tutor: Run follow-up evals (dev)** with a real provider. Record the pass count and both answers in the task report. A ❌ on `wrong-pushback.json` means the prompt lets the model be talked out of a correct claim; report it rather than tuning the prompt in this task.
