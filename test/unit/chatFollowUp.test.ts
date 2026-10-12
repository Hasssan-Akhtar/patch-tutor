// @vitest-environment happy-dom
import type { Window as DomWindow, HTMLButtonElement, HTMLTextAreaElement } from 'happy-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  chatShellHtml,
  messageHtml,
  type ChatState,
  type QuizPanel,
} from '../../src/ui/chat/chatHtml';
import { escapeModelText } from '../../src/ui/markdownStyle';

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
  settings: {
    active: { provider: 'vscodeLm', model: '', baseUrl: '' },
    providers: [],
    presets: [],
    version: 1,
  },
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

describe('follow-up answers in the chat view', () => {
  it('renders a dry run code block as code, not as raw text', () => {
    const answer =
      'Dry run:\n\n```javascript\nconst price = 100;\nif (a < b) {}\n```\n\n1. Returns `80`.';
    const html = messageHtml({ from: 'tutor', text: escapeModelText(answer) }).html;

    expect(html).toContain(
      '<pre><code class="language-javascript">const price = 100;\nif (a &lt; b) {}\n</code></pre>',
    );
    expect(html).toContain('<ol>');
    expect(html).not.toContain('```');
  });
});
