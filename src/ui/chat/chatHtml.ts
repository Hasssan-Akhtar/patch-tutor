import MarkdownIt from 'markdown-it';
import type { QuizMessage } from '../quizRun';

// Tutor messages are built by our Markdown helpers, which escape all model text
// and add only <span> color labels, so inline HTML is ours alone. Links are
// validated by markdown-it (no javascript: URLs) and images were neutralized
// before rendering.
const markdown = new MarkdownIt({ html: true, linkify: false, breaks: false });

export interface ChatMessageView {
  from: 'tutor' | 'you';
  html: string;
}

export interface ChatState {
  /** The change being quizzed, or undefined before any quiz is moved here. */
  header?: { file: string; line: number };
  messages: ChatMessageView[];
  canAnswer: boolean;
  busy: boolean;
  done: boolean;
}

export function messageHtml(message: QuizMessage): ChatMessageView {
  if (message.from === 'you') {
    return { from: 'you', html: escapeHtml(message.text).replace(/\n/g, '<br>') };
  }
  if (message.pending) {
    return {
      from: 'tutor',
      html: `<span class="typing" aria-label="${escapeHtml(message.text)}"><i></i><i></i><i></i></span> <span class="muted">${escapeHtml(message.text)}</span>`,
    };
  }
  return { from: 'tutor', html: markdown.render(message.text) };
}

export interface ChatPageSecurity {
  nonce: string;
  cspSource: string;
  /** webview URI of the Patch Tutor avatar. */
  avatarUri: string;
}

/**
 * The chat page shell. Messages arrive later via postMessage so typing is not
 * lost on updates. Scripts need the nonce; nothing may load from the network.
 */
export function chatShellHtml(security: ChatPageSecurity): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${security.cspSource}; style-src ${security.cspSource} 'unsafe-inline'; script-src 'nonce-${security.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${STYLES}</style>
</head>
<body data-avatar="${escapeHtml(security.avatarUri)}">
<header id="header" hidden>
  <span>🎓 Quiz on <button class="link" data-action="showChange" id="where"></button></span>
</header>
<main id="messages" aria-live="polite"></main>
<section id="empty" class="empty">
  <div class="empty-icon">💬</div>
  <h2>Quiz chat</h2>
  <p>Click <strong>Quiz me</strong> above a change, then <strong>Move to chat</strong> to answer here with more room.</p>
</section>
<footer id="composer" hidden>
  <textarea id="answer" rows="3" placeholder="Type your answer. Short is fine. Enter to send, Shift+Enter for a new line."></textarea>
  <div class="actions">
    <button class="primary" data-action="submit" id="submit">Submit</button>
    <button data-action="reveal" id="reveal">Show answer</button>
    <button data-action="skip" id="skip">Skip</button>
  </div>
</footer>
<footer id="finished" hidden>
  <div class="actions">
    <button class="primary" data-action="anotherRound">🔁 Another round</button>
    <button data-action="showChange">Show change</button>
  </div>
</footer>
<script nonce="${security.nonce}">${SCRIPT}</script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
body { margin: 0; padding: 0; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); display: flex; flex-direction: column; height: 100vh; }
header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border, transparent); font-size: 12px; color: var(--vscode-descriptionForeground); }
main { flex: 1; overflow-y: auto; padding: 8px 12px; }
.msg { display: flex; gap: 8px; margin: 10px 0; }
.msg.you { justify-content: flex-end; }
.avatar { width: 22px; height: 22px; border-radius: 5px; flex: none; margin-top: 2px; }
.bubble { padding: 8px 10px; border-radius: 10px; max-width: 88%; line-height: 1.45; overflow-wrap: anywhere; }
.tutor .bubble { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border, transparent); border-top-left-radius: 3px; }
.you .bubble { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-top-right-radius: 3px; }
.bubble p { margin: 0 0 8px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble hr { border: none; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); margin: 10px 0; }
.bubble code { font-family: var(--vscode-editor-font-family); font-size: .92em; background: var(--vscode-textCodeBlock-background); border-radius: 3px; padding: 0 3px; }
.bubble ul { margin: 4px 0 8px; padding-left: 18px; }
.muted { color: var(--vscode-descriptionForeground); }
.typing i { display: inline-block; width: 5px; height: 5px; margin-right: 3px; border-radius: 50%; background: var(--vscode-descriptionForeground); animation: blink 1.2s infinite both; }
.typing i:nth-child(2) { animation-delay: .2s; }
.typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .2; } 40% { opacity: 1; } }
footer { padding: 8px 12px 12px; border-top: 1px solid var(--vscode-panel-border, transparent); }
textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; padding: 6px 8px; }
textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
.actions { display: flex; gap: 6px; margin-top: 6px; flex-wrap: wrap; }
button { font: inherit; cursor: pointer; border-radius: 4px; padding: 4px 10px; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border: none; }
button:hover { background: var(--vscode-button-secondaryHoverBackground); }
button.primary { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
button.primary:hover { background: var(--vscode-button-hoverBackground); }
button:disabled { opacity: .5; cursor: default; }
button.link { background: none; padding: 0; color: var(--vscode-textLink-foreground); }
button.link:hover { text-decoration: underline; background: none; }
.empty { text-align: center; padding: 24px 16px; }
.empty-icon { font-size: 30px; }
.empty h2 { font-size: 14px; margin: 6px 0; }
.empty p { color: var(--vscode-descriptionForeground); line-height: 1.4; }
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const avatar = document.body.dataset.avatar;
const answer = $('answer');
let state;

function render(next) {
  state = next;
  const hasQuiz = !!state.header;
  $('empty').hidden = hasQuiz;
  $('header').hidden = !hasQuiz;
  if (hasQuiz) $('where').textContent = state.header.file + ':' + state.header.line;

  const list = $('messages');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = '';
  for (const m of state.messages) {
    const row = document.createElement('div');
    row.className = 'msg ' + m.from;
    if (m.from === 'tutor') {
      const img = document.createElement('img');
      img.className = 'avatar';
      img.src = avatar;
      img.alt = '';
      row.appendChild(img);
    }
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = m.html; // Built and sanitized by the extension.
    row.appendChild(bubble);
    list.appendChild(row);
  }
  if (atBottom || state.busy) list.scrollTop = list.scrollHeight;

  $('composer').hidden = !hasQuiz || state.done;
  $('finished').hidden = !hasQuiz || !state.done;
  for (const id of ['submit', 'reveal', 'skip']) $(id).disabled = !state.canAnswer;
  if (state.canAnswer && document.activeElement !== answer) answer.focus();
}

function send() {
  if (!state || !state.canAnswer) return;
  const text = answer.value.trim();
  if (!text) { answer.focus(); return; }
  vscode.postMessage({ action: 'submit', text });
  answer.value = '';
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  event.preventDefault();
  if (target.dataset.action === 'submit') send();
  else vscode.postMessage({ action: target.dataset.action });
});
answer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'state') render(event.data.state);
});
vscode.postMessage({ action: 'ready' });
`;
