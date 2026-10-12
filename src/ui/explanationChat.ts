import type { Hunk } from '../git/hunk';
import type { Depth, Explanation } from '../llm/schemas';
import type { HunkContext } from '../services/explainService';
import type { Exchange, FollowUpService } from '../services/followUpService';
import { escapeModelText } from './markdownStyle';
import { failureMarkdown, type QuizMessage } from './quizRun';

export type AskResult = 'answered' | 'empty' | 'not-ready' | 'failed';

const REVISED_NOTE = '✏️ **I corrected the explanation above.**';

/**
 * A follow-up conversation about one explanation. Like QuizRun it knows
 * nothing about where it is shown: the comment thread and the chat view are
 * both renderings of `messages`.
 */
export class ExplanationChat {
  private readonly listeners = new Set<() => void>();
  private readonly cancelListeners = new Set<() => void>();
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
      this.messages.push({
        from: 'tutor',
        text: answerMarkdown(result.answer, result.revised && result.mistake),
      });
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

  /** Fires once when the chat is cancelled, e.g. when the chat view replaces it. */
  onDidCancel(listener: () => void): { dispose(): void } {
    this.cancelListeners.add(listener);
    return { dispose: () => this.cancelListeners.delete(listener) };
  }

  cancel(): void {
    if (this.cancelled) {
      return;
    }
    this.controller.abort();
    this.listeners.clear();
    this.cancelListeners.forEach((listener) => listener());
    this.cancelListeners.clear();
  }

  private changed(): void {
    this.listeners.forEach((listener) => listener());
  }
}

/** The answer, plus what was corrected when the reply revised the explanation. */
function answerMarkdown(answer: string, mistake: string | undefined): string {
  const text = escapeModelText(answer.trim());
  return mistake ? `${text}\n\n${REVISED_NOTE} ${escapeModelText(mistake)}` : text;
}
