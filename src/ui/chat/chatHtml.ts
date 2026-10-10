import MarkdownIt from 'markdown-it';
import { timeAgo } from '../../learning/stats';
import type { Transcript } from '../../learning/transcripts';
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

export interface QuizPanel {
  file: string;
  line: number;
  messages: ChatMessageView[];
  canAnswer: boolean;
  busy: boolean;
  done: boolean;
}

export interface HistoryItem {
  id: string;
  /** "cart.js:12" */
  where: string;
  /** "2/3 correct · 1h ago", or "In progress · …" */
  meta: string;
  /** Escaped first question, shown as a preview. */
  preview: string;
  current: boolean;
}

export interface SettingsProvider {
  id: string;
  label: string;
  detail: string;
  usesKey: boolean;
  usesBaseUrl: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Whether a key is stored; the key itself never reaches the page. */
  keySaved: boolean;
  keyUrl?: string;
}

export interface SettingsPanel {
  active: { provider: string; model: string; baseUrl: string };
  providers: SettingsProvider[];
  presets: readonly { label: string; url: string; needsKey: boolean }[];
  /** Bumped when saved settings or keys change, so the form re-reads them. */
  version: number;
}

export interface ChatState {
  tab: 'quiz' | 'history' | 'settings';
  /** "Anthropic · claude-opus-5-5", shown as a chip that opens settings. */
  modelLabel: string;
  quiz?: QuizPanel;
  history: HistoryItem[];
  /** A past quiz opened from History. */
  viewing?: { where: string; meta: string; messages: ChatMessageView[] };
  settings: SettingsPanel;
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

/** A one-line result for a saved quiz. */
export function transcriptMeta(t: Transcript, now: number): string {
  const attempted = t.total - t.revealed - t.skipped;
  let result: string;
  if (!t.done) {
    result = 'In progress';
  } else if (attempted === 0) {
    result = 'Answers peeked';
  } else {
    result = `${t.correct}/${attempted} correct${t.partly > 0 ? `, ${t.partly} partly` : ''}`;
  }
  return `${result} · ${timeAgo(t.startedAt, now)}`;
}

export function historyItem(t: Transcript, now: number, currentId?: string): HistoryItem {
  return {
    id: t.id,
    where: `${basename(t.filePath)}:${t.line}`,
    meta: transcriptMeta(t, now),
    preview: withInlineCode(t.questions[0] ?? ''),
    current: t.id === currentId,
  };
}

export interface ChatPageSecurity {
  nonce: string;
  cspSource: string;
  /** webview URI of the Patch Tutor avatar. */
  avatarUri: string;
}

/**
 * The chat page shell. State arrives via postMessage so typing is not lost on
 * updates. Scripts need the nonce; nothing may load from the network.
 */
export function chatShellHtml(security: ChatPageSecurity): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${security.cspSource}; style-src ${security.cspSource} 'unsafe-inline'; script-src 'nonce-${security.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>${STYLES}${SETTINGS_STYLES}</style>
</head>
<body data-avatar="${escapeHtml(security.avatarUri)}">
<nav class="tabs" role="tablist">
  <button role="tab" data-action="tab" data-tab="quiz" id="tab-quiz">💬 Quiz</button>
  <button role="tab" data-action="tab" data-tab="history" id="tab-history">🕘 History</button>
  <button class="chip" data-action="tab" data-tab="settings" id="model-chip" title="Model settings"></button>
</nav>
<section id="settings" class="settings" hidden>
  <h2>Model settings</h2>
  <p class="muted">Using <strong id="active-label"></strong></p>
  <div id="provider-list" class="providers" role="radiogroup" aria-label="Provider"></div>
  <div id="field-url" class="field" hidden>
    <label for="base-url">Server URL</label>
    <select id="preset" hidden></select>
    <input id="base-url" type="url" spellcheck="false" placeholder="https://…">
  </div>
  <div id="field-key" class="field" hidden>
    <label for="api-key">API key</label>
    <div id="key-saved" class="key-saved" hidden>
      <span>🔒 Saved in your OS keychain</span>
      <button class="link" data-action="replaceKey">Replace</button>
      <button class="link danger" data-action="removeKey">Remove</button>
    </div>
    <input id="api-key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste your API key">
    <p class="muted small"><span id="key-optional" hidden>Optional for local servers. </span>Stored only in VS Code's secret storage, never in settings. <button class="link" data-action="openKeyUrl" id="key-link">Get a key</button></p>
  </div>
  <div class="field">
    <label for="model">Model</label>
    <div class="row">
      <input id="model" list="model-options" spellcheck="false" placeholder="Default">
      <button data-action="loadModels" title="Load the models this provider offers">↻</button>
    </div>
    <datalist id="model-options"></datalist>
    <p class="muted small" id="model-status"></p>
  </div>
  <div class="actions">
    <button data-action="test">Test connection</button>
    <button class="primary" data-action="saveSettings">Save &amp; use</button>
  </div>
  <p id="settings-status" class="status" role="status"></p>
  <p class="muted small">Your code is sent only to the provider you choose here. Patch Tutor has no server and no telemetry.</p>
</section>
<div id="bar" class="bar" hidden></div>
<main id="messages" aria-live="polite"></main>
<section id="list" class="list" hidden></section>
<section id="empty" class="empty" hidden>
  <div class="empty-icon">💬</div>
  <h2>No quiz here yet</h2>
  <p>Click <strong>Quiz me</strong> above a change, then <strong>Move to chat</strong> to answer here with more room.</p>
  <p><button class="link" data-action="tab" data-tab="history">See past quizzes</button></p>
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
<script nonce="${security.nonce}">${SCRIPT}${SETTINGS_SCRIPT}</script>
</body>
</html>`;
}

function withInlineCode(text: string): string {
  return escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
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
.tabs { display: flex; gap: 4px; padding: 6px 10px 0; border-bottom: 1px solid var(--vscode-panel-border, transparent); }
.tabs button { background: none; border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 4px 8px 6px; color: var(--vscode-descriptionForeground); }
.tabs button:hover { background: none; color: var(--vscode-foreground); }
.tabs button.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
.bar { padding: 8px 12px; font-size: 12px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border, transparent); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
main { flex: 1; overflow-y: auto; padding: 4px 12px 8px; }
main[hidden] { display: none; }
.msg { display: flex; gap: 8px; margin: 10px 0; }
.msg.you { justify-content: flex-end; }
.avatar { width: 22px; height: 22px; border-radius: 5px; flex: none; margin-top: 2px; }
.bubble { padding: 8px 10px; border-radius: 10px; max-width: 88%; line-height: 1.45; overflow-wrap: anywhere; }
.tutor .bubble { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border, transparent); border-top-left-radius: 3px; }
.you .bubble { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-top-right-radius: 3px; }
.bubble p { margin: 0 0 8px; }
.bubble p:last-child { margin-bottom: 0; }
.bubble hr { border: none; border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); margin: 10px 0; }
code { font-family: var(--vscode-editor-font-family); font-size: .92em; background: var(--vscode-textCodeBlock-background); border-radius: 3px; padding: 0 3px; }
.bubble ul { margin: 4px 0 8px; padding-left: 18px; }
.muted { color: var(--vscode-descriptionForeground); }
.typing i { display: inline-block; width: 5px; height: 5px; margin-right: 3px; border-radius: 50%; background: var(--vscode-descriptionForeground); animation: blink 1.2s infinite both; }
.typing i:nth-child(2) { animation-delay: .2s; }
.typing i:nth-child(3) { animation-delay: .4s; }
@keyframes blink { 0%, 80%, 100% { opacity: .2; } 40% { opacity: 1; } }
.list { flex: 1; overflow-y: auto; padding: 6px 8px; }
.item { display: block; width: 100%; text-align: left; background: none; border: none; border-radius: 6px; padding: 8px; color: inherit; }
.item:hover { background: var(--vscode-list-hoverBackground); }
.item .top { display: flex; justify-content: space-between; gap: 8px; }
.item .where { font-weight: 600; }
.item .preview { display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
.badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
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
.empty { text-align: center; padding: 24px 16px; flex: 1; }
.empty-icon { font-size: 30px; }
.empty h2 { font-size: 14px; margin: 6px 0; }
.empty p { color: var(--vscode-descriptionForeground); line-height: 1.4; }
`;

const SETTINGS_STYLES = `
.chip { margin-left: auto; max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; padding: 2px 8px !important; border-radius: 10px !important; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)) !important; color: var(--vscode-descriptionForeground) !important; align-self: center; }
.chip:hover, .chip.active { color: var(--vscode-foreground) !important; }
.settings { flex: 1; overflow-y: auto; padding: 4px 12px 12px; }
.settings h2 { font-size: 14px; margin: 8px 0 2px; }
.providers { display: grid; gap: 6px; margin: 10px 0; }
.provider { display: block; width: 100%; text-align: left; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); background: none; color: inherit; }
.provider:hover { background: var(--vscode-list-hoverBackground); }
.provider.selected { border-color: var(--vscode-focusBorder); background: var(--vscode-list-activeSelectionBackground, transparent); color: var(--vscode-list-activeSelectionForeground, inherit); }
.provider .title { font-weight: 600; }
.provider .desc { display: block; font-size: 12px; opacity: .8; margin-top: 2px; }
.field { margin: 10px 0; }
.field label { display: block; font-weight: 600; margin-bottom: 4px; }
.field input, .field select { width: 100%; box-sizing: border-box; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 4px 6px; }
.field select { margin-bottom: 6px; }
.row { display: flex; gap: 6px; }
.row input { flex: 1; }
.small { font-size: 11.5px; }
.key-saved { display: flex; gap: 10px; align-items: center; margin-bottom: 6px; }
.status { min-height: 1.2em; }
.status.ok { color: var(--vscode-testing-iconPassed, #1FAA6E); }
.status.error { color: var(--vscode-errorForeground); }
.danger { color: var(--vscode-errorForeground) !important; }
`;

// Settings form: the page owns the inputs while open and re-reads saved
// values only when they change, so typing is never overwritten. Keys typed
// here are sent once to the extension and never sent back.
const SETTINGS_SCRIPT = `
let form = null;
let settingsVersion = -1;
let replacingKey = false;

function providerById(id) { return state.settings.providers.find((p) => p.id === id); }

function renderSettings(force) {
  const s = state.settings;
  $('active-label').textContent = state.modelLabel;
  if (!force && form && settingsVersion === s.version) return;
  settingsVersion = s.version;
  form = { provider: s.active.provider, model: s.active.model, baseUrl: s.active.baseUrl };
  replacingKey = false;
  $('api-key').value = '';
  $('model-options').innerHTML = '';
  $('model-status').textContent = '';
  drawForm();
  autoLoadModels();
}

function drawForm() {
  const s = state.settings;
  const info = providerById(form.provider);
  const list = $('provider-list');
  list.innerHTML = '';
  for (const p of s.providers) {
    const card = document.createElement('button');
    card.className = 'provider' + (p.id === form.provider ? ' selected' : '');
    card.setAttribute('role', 'radio');
    card.setAttribute('aria-checked', String(p.id === form.provider));
    card.dataset.action = 'pickProvider';
    card.dataset.id = p.id;
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = p.label;
    const desc = document.createElement('span');
    desc.className = 'desc';
    desc.textContent = p.detail;
    card.append(title, desc);
    list.appendChild(card);
  }

  show('field-url', info.usesBaseUrl);
  const preset = $('preset');
  preset.hidden = form.provider !== 'openaiCompatible';
  if (!preset.hidden) {
    preset.innerHTML = '';
    for (const p of s.presets.concat([{ label: 'Custom URL', url: '' }])) {
      const option = document.createElement('option');
      option.value = p.url;
      option.textContent = p.url ? p.label + ' (' + p.url + ')' : p.label;
      preset.appendChild(option);
    }
    const known = s.presets.some((p) => p.url === (form.baseUrl || info.defaultBaseUrl));
    preset.value = known ? (form.baseUrl || info.defaultBaseUrl) : '';
  }
  $('base-url').value = form.baseUrl || info.defaultBaseUrl;

  show('field-key', info.usesKey);
  const saved = info.keySaved && !replacingKey;
  show('key-saved', saved);
  $('api-key').hidden = saved;
  const local = form.provider === 'openaiCompatible' && /^http:\\/\\/(localhost|127\\.0\\.0\\.1)/.test($('base-url').value);
  show('key-optional', local);
  $('key-link').hidden = !info.keyUrl || local;

  $('model').value = form.model;
  $('model').placeholder = info.defaultModel ? 'Default: ' + info.defaultModel : 'Pick or type a model';
}

function readForm() {
  const info = providerById(form.provider);
  form.model = $('model').value.trim();
  form.baseUrl = info.usesBaseUrl ? $('base-url').value.trim() : '';
  const key = $('api-key').value.trim();
  return { provider: form.provider, model: form.model, baseUrl: form.baseUrl, key: key || undefined };
}

function setStatus(text, kind) {
  const el = $('settings-status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

function autoLoadModels() {
  const info = providerById(form.provider);
  // Only fetch when it can work without more input from the user.
  if (!info.usesKey || info.keySaved || form.provider === 'openaiCompatible') {
    requestModels();
  } else {
    $('model-status').textContent = 'Add your API key to load the model list.';
  }
}

function requestModels() {
  $('model-status').textContent = 'Loading models…';
  vscode.postMessage({ action: 'loadModels', form: readForm() });
}

function onSettingsMessage(data) {
  if (data.type === 'models') {
    if (!form || data.provider !== form.provider) return;
    const options = $('model-options');
    options.innerHTML = '';
    for (const m of data.models) {
      const option = document.createElement('option');
      option.value = m.id;
      if (m.label && m.label !== m.id) option.label = m.label;
      options.appendChild(option);
    }
    $('model-status').textContent = data.error
      ? data.error
      : data.models.length + ' model' + (data.models.length === 1 ? '' : 's') + ' available. Pick one or type a name.';
  } else if (data.type === 'testResult' || data.type === 'saved') {
    setStatus(data.text, data.ok ? 'ok' : 'error');
  }
}

function onSettingsClick(target) {
  const action = target.dataset.action;
  if (action === 'pickProvider') {
    readForm();
    const info = providerById(target.dataset.id);
    form = { provider: info.id, model: form.provider === info.id ? form.model : '', baseUrl: form.provider === info.id ? form.baseUrl : '' };
    replacingKey = false;
    $('api-key').value = '';
    $('model-options').innerHTML = '';
    setStatus('');
    drawForm();
    autoLoadModels();
  } else if (action === 'replaceKey') {
    replacingKey = true;
    readForm();
    drawForm();
    $('api-key').focus();
  } else if (action === 'removeKey') {
    vscode.postMessage({ action: 'removeKey', provider: form.provider });
  } else if (action === 'openKeyUrl') {
    vscode.postMessage({ action: 'openKeyUrl', provider: form.provider });
  } else if (action === 'loadModels') {
    requestModels();
  } else if (action === 'test') {
    setStatus('Testing…');
    vscode.postMessage({ action: 'test', form: readForm() });
  } else if (action === 'saveSettings') {
    setStatus('Saving…');
    vscode.postMessage({ action: 'saveSettings', form: readForm() });
    $('api-key').value = '';
  } else {
    return false;
  }
  return true;
}

$('preset').addEventListener('change', () => {
  if ($('preset').value) $('base-url').value = $('preset').value;
  else { $('base-url').value = ''; $('base-url').focus(); }
  readForm();
  drawForm();
  requestModels();
});
$('base-url').addEventListener('change', () => { readForm(); drawForm(); requestModels(); });
$('api-key').addEventListener('change', () => { if ($('api-key').value.trim()) requestModels(); });
`;

const SCRIPT = `
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const avatar = document.body.dataset.avatar;
const answer = $('answer');
let state;

function show(id, visible) { $(id).hidden = !visible; }

function renderMessages(messages, follow) {
  const list = $('messages');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = '';
  for (const m of messages) {
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
  if (follow || atBottom) list.scrollTop = list.scrollHeight;
}

function render(next) {
  const switched = !state || state.tab !== next.tab || !!state.viewing !== !!next.viewing;
  state = next;
  $('tab-quiz').classList.toggle('active', state.tab === 'quiz');
  $('tab-history').classList.toggle('active', state.tab === 'history');
  $('tab-history').textContent = '🕘 History' + (state.history.length ? ' (' + state.history.length + ')' : '');
  $('model-chip').textContent = '⚙ ' + state.modelLabel;
  $('model-chip').classList.toggle('active', state.tab === 'settings');
  for (const id of ['bar', 'messages', 'list', 'empty', 'composer', 'finished', 'settings']) show(id, false);

  if (state.tab === 'settings') {
    show('settings', true);
    renderSettings(switched);
    return;
  }

  const bar = $('bar');
  if (state.tab === 'quiz') {
    const quiz = state.quiz;
    if (!quiz) { show('empty', true); return; }
    bar.innerHTML = '';
    bar.append('🎓 Quiz on ');
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
    for (const id of ['submit', 'reveal', 'skip']) $(id).disabled = !quiz.canAnswer;
    if (quiz.canAnswer && document.activeElement !== answer) answer.focus();
    return;
  }

  if (state.viewing) {
    bar.innerHTML = '';
    const back = document.createElement('button');
    back.className = 'link';
    back.dataset.action = 'closeTranscript';
    back.textContent = '← All quizzes';
    const label = document.createElement('span');
    label.textContent = state.viewing.where + ' · ' + state.viewing.meta;
    bar.append(back, label);
    show('bar', true);
    show('messages', true);
    if (switched) $('messages').scrollTop = 0;
    renderMessages(state.viewing.messages, false);
    return;
  }

  const list = $('list');
  list.innerHTML = '';
  if (!state.history.length) {
    list.innerHTML = '<p class="muted">No past quizzes yet. Your quizzes are saved here as you take them, in the thread or in the chat.</p>';
  }
  for (const item of state.history) {
    const button = document.createElement('button');
    button.className = 'item';
    button.dataset.action = 'openTranscript';
    button.dataset.id = item.id;
    button.innerHTML = '<span class="top"><span class="where"></span><span class="muted meta"></span></span><span class="preview"></span>';
    button.querySelector('.where').textContent = item.where;
    button.querySelector('.meta').textContent = item.meta;
    button.querySelector('.preview').innerHTML = item.preview; // Escaped by the extension.
    if (item.current) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'in chat';
      button.querySelector('.where').append(' ', badge);
    }
    list.appendChild(button);
  }
  show('list', true);
}

function send() {
  if (!state || !state.quiz || !state.quiz.canAnswer) return;
  const text = answer.value.trim();
  if (!text) { answer.focus(); return; }
  vscode.postMessage({ action: 'submit', text });
  answer.value = '';
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  event.preventDefault();
  if (onSettingsClick(target)) return;
  const { action, tab, id } = target.dataset;
  if (action === 'submit') send();
  else vscode.postMessage({ action, tab, id });
});
answer.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});
window.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'state') render(event.data.state);
  else onSettingsMessage(event.data);
});
vscode.postMessage({ action: 'ready' });
`;
