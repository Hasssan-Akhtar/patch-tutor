# Explanation follow-up chat and refresh

Date: 2026-10-12
Status: approved design, awaiting spec review

## Goal

After reading an inline explanation, a user can ask follow-up questions or
push back ("that's wrong, it doesn't reduce DB calls"). The tutor answers with
the same hunk context and, when the user is right, revises the explanation.
The conversation lives in the inline comment thread and can be moved to the
sidebar chat, like a quiz. A Refresh button regenerates an explanation without
the cache.

Success looks like:

- A user can reply under any explanation and get an answer grounded in the diff.
- A correct pushback produces a revised explanation; an incorrect one does not.
- Refresh produces a fresh explanation and clears the conversation.
- Quizzes in the same thread behave exactly as they do today.

## Decisions

- Chat is for questions and pushback (not just thumbs up/down).
- Chat is inline, with "Move to chat" to continue in the sidebar.
- Refresh or a depth change starts a new conversation.
- Revised explanations are never written to the cache.
- Chats are not saved to History in v1. No streaming in v1.
- The provider interface stays single-turn; history is folded into the prompt.

## Architecture

### `ExplanationChat` (`src/ui/explanationChat.ts`)

One conversation about one explanation, modeled on `QuizRun`. It knows
nothing about where it is shown; the thread and the sidebar both render
`messages`.

- Holds: `hunk`, `repoRoot`, current `explanation`, `depth`, the
  `HunkContext` built for the explanation, and `messages: QuizMessage[]`.
- Members shared with `QuizRun`: `messages`, `busy`, `onDidChange`, `cancel()`.
- `ask(text)`: appends the user message and a pending tutor message, calls
  `FollowUpService`, then replaces the pending message with the answer or an
  error. Returns `'empty'` for blank input and `'not-ready'` while busy.
- `canSend`: true when not busy and not cancelled.
- When the reply includes `revised`, the chat updates `explanation` and fires
  `onDidChange`; the owner re-renders the explanation comment with a
  "✏️ Revised after your reply" tag.

A small shared interface, `LiveConversation`, names the members the sidebar
needs from either a `QuizRun` or an `ExplanationChat`.

### `FollowUpService` (`src/services/followUpService.ts`)

Builds the request and calls the provider through `completeStructured`, so UI
code never calls providers directly.

- Inputs: hunk, depth, `HunkContext`, current explanation, prior exchanges,
  the new question, abort signal.
- Prompt: `src/prompts/follow-up.md` (system) and `follow-up-user.md` (user),
  reusing `hunkPromptValues` for the diff and context sections.
- History: only the last 6 exchanges are sent; older ones are dropped first.
  Trimming is a pure, tested function.
- Output schema in `src/llm/schemas.ts`:
  `FollowUpSchema = { answer: string (min 1), revised?: Explanation }`.
- If the reply fails the schema after the fix-JSON retry, the raw text is used
  as `answer` with no revision.

### Prompt rules (`follow-up.md`)

- Answer only from the diff and context given; say "I'm not sure" and what is
  missing instead of guessing.
- When the user disputes a claim, re-check it against the diff before replying.
  Concede and return `revised` only when the diff shows the user is right.
  Otherwise explain, politely and concretely, why the original claim holds.
- Return `revised` only for a correction to the explanation, never for a
  question that was just answered.
- Keep answers short; Markdown inline code for identifiers.

### Thread changes (`src/ui/threads.ts`)

- `ThreadEntry` gains `context?: HunkContext`, `chat?: ExplanationChat`,
  `chatInChat?: boolean` and `revised?: boolean`.
- Render order: explanation, chat messages, quiz, notes.
- `canReply` is true when a quiz is waiting for an answer, or when there is an
  explanation and no active quiz.
- `contextValue` keeps `patchTutorThread <depth>` and the ` quiz` suffix; the
  reply-box menus use it to pick buttons.
- Controller prompt becomes "Answer the quiz or ask a follow-up…" because the
  stable API has no per-thread placeholder.
- When the chat moved to the sidebar, the thread shows the explanation plus
  "💬 This conversation continues in the Patch Tutor chat."
- `close` aborts the chat unless it moved to the sidebar.

### Explain flow

The explain command stores the `HunkContext` it built on the thread entry, so
follow-ups do not repeat language-server lookups. `ExplainService` exposes the
context it used (for example by returning it with the result).

### Commands and menus (`package.json`, `src/ui/inlineCommands.ts`)

- `patchTutor.thread.refresh` (`$(refresh)`), in the thread title bar:
  aborts any in-flight work, re-runs `explainHunk` with `skipCache: true`,
  rebuilds the context and starts a new conversation.
- `patchTutor.chat.ask`: reply-box button when no quiz is active; routes the
  reply text to the entry's chat (creating it on first use).
- `patchTutor.chat.moveToChat`: reply-box and title-bar button when a chat has
  messages and no quiz is active; hands the chat to the sidebar.
- Quiz buttons are unchanged and still shown only while a quiz is active.
- Depth changes (simpler/deeper) start a new conversation.

### Sidebar (`src/ui/chat/chatView.ts`, `chatHtml.ts`)

- `ChatView` holds a live `QuizRun | ExplanationChat` instead of only a quiz;
  `adopt()` accepts either. Only one is live at a time; adopting one cancels
  the other, as today.
- For a chat, the Quiz tab heading reads "Follow-up · file:line", the
  explanation TL;DR is pinned at the top, and Skip, Show answer and Another
  round are hidden. The input and send button route to `ask`.
- `ChatState` gains a `kind: 'quiz' | 'followUp'` on the live panel.

## Errors

- Provider errors become a tutor message in the conversation with the
  existing Test connection and Choose provider links; the user's question
  stays and can be sent again.
- Cancelled requests show "Cancelled." and leave the chat usable.
- Closing the thread, Refresh, or a depth change aborts in-flight requests.

## Testing

Vitest:

- `FollowUpSchema` with and without `revised`, and rejection of an empty answer.
- Follow-up prompt building and history trimming to the last 6 exchanges.
- `ExplanationChat` with a fake service: message flow, pending state, busy
  guard, empty input, a revision replacing the explanation, errors, cancel.
- happy-dom: the sidebar hides quiz-only buttons for a follow-up and routes
  send to `ask`.

Prompt evals (`src/dev/promptEvals.ts`):

- Correct pushback: the user points out a real mistake; expect `revised`.
- Incorrect pushback: the user insists on something the diff contradicts;
  expect no `revised` and an answer that holds the original claim.

## Out of scope for v1

Saving chats to History, streaming replies, multi-turn provider APIs.
