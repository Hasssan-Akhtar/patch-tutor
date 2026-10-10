import type { ActivityEntry, ConceptSummary, HunkRef } from '../../learning/conceptStore';
import { masteryLevel, type MasteryLevel } from '../../learning/concepts';
import type { Outcome } from '../../learning/quizSession';
import { timeAgo, type ProgressStats } from '../../learning/stats';

export interface DashboardModel {
  stats: ProgressStats;
  concepts: ConceptSummary[];
  activity: ActivityEntry[];
  /** Saved changes by hunk id, for showing diffs next to activity. */
  hunks: Record<string, HunkRef>;
  now: number;
}

export interface PageSecurity {
  /** Random per render; only scripts and styles carrying it may run. */
  nonce: string;
  /** The webview's own origin (webview.cspSource). */
  cspSource: string;
}

export const RECENT_ACTIVITY = 15;
const PRACTICE_NEXT = 3;

const OUTCOME: Record<Outcome, { icon: string; label: string }> = {
  correct: { icon: '🎉', label: 'Correct' },
  partly: { icon: '👍', label: 'Partly right' },
  wrong: { icon: '🌱', label: 'Not yet' },
  revealed: { icon: '🙈', label: 'Peeked' },
  skipped: { icon: '⏭️', label: 'Skipped' },
  ungraded: { icon: '🤷', label: 'Not graded' },
};

const LEVEL_LABEL: Record<MasteryLevel, string> = {
  weak: 'Needs practice',
  shaky: 'Getting there',
  solid: 'Solid',
};

/**
 * The whole Progress page. Pure so it can be unit-tested; every value from
 * the store (concept names, model-written questions and feedback, your
 * answers, file paths, diffs) is escaped, and the CSP allows no network access.
 * Details expand in place; nothing opens in a new editor unless asked.
 */
export function dashboardHtml(model: DashboardModel, security: PageSecurity): string {
  const body =
    model.activity.length === 0 && model.concepts.length === 0
      ? emptyState()
      : [
          statsSection(model.stats, model.concepts.length),
          conceptsSection(model.concepts, model.now),
          activitySection(model.activity, model.hunks, model.now),
          footer(),
        ].join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${security.cspSource} 'nonce-${security.nonce}'; script-src 'nonce-${security.nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${security.nonce}">${STYLES}</style>
</head>
<body>
${body}
<script nonce="${security.nonce}">${SCRIPT}</script>
</body>
</html>`;
}

function emptyState(): string {
  return `<section class="empty">
  <div class="empty-icon">🎓</div>
  <h2>No quiz results yet</h2>
  <p>Open a changed file and click <strong>Quiz me</strong> above a change. Your answers, scores and the concepts worth practising will show up here.</p>
  <p class="muted">Everything stays on this machine.</p>
</section>`;
}

function statsSection(stats: ProgressStats, conceptCount: number): string {
  const accuracy = stats.accuracy === undefined ? '–' : `${Math.round(stats.accuracy * 100)}%`;
  const tile = (value: string, label: string, title: string) =>
    `<div class="tile" title="${escape(title)}"><div class="value">${value}</div><div class="label">${label}</div></div>`;
  return `<section>
  <h2>Your progress</h2>
  <div class="tiles">
    ${tile(String(stats.answered), 'answered', `${stats.answeredToday} today. Skipped questions are not counted.`)}
    ${tile(accuracy, 'accuracy', 'Last 30 days. Correct counts 1, partly 0.5, wrong or peeked 0.')}
    ${tile(`${stats.streakDays}${stats.streakDays > 0 ? ' 🔥' : ''}`, 'day streak', 'Days in a row with at least one answer.')}
    ${tile(String(conceptCount), 'concepts', 'Programming concepts you have been quizzed on.')}
  </div>
</section>`;
}

function conceptsSection(concepts: ConceptSummary[], now: number): string {
  if (concepts.length === 0) {
    return '';
  }
  const next = concepts.filter((c) => masteryLevel(c.score) !== 'solid').slice(0, PRACTICE_NEXT);
  const hint =
    next.length > 0
      ? `<p class="hint">🎯 Practice next: ${next.map((c) => `<strong>${escape(c.name)}</strong>`).join(', ')}</p>`
      : `<p class="hint">🏆 Everything you've practised is solid. Quiz a new change to keep going.</p>`;
  const items = concepts
    .map((c) => {
      const changes = c.hunks
        .map(
          (h) => `<details class="change" data-key="${escape(`h:${c.name}:${h.hunkId}`)}">
  <summary><span class="file">${escape(h.filePath)}:${h.line}</span> <span class="muted">${timeAgo(h.lastSeen, now)}</span></summary>
  ${diffBlock(h.diff)}
  ${openFileButton(h.filePath, h.line)}
</details>`,
        )
        .join('\n');
      return `<details class="concept-item" data-key="${escape(`c:${c.name}`)}">
  <summary>${conceptRow(c)}</summary>
  <div class="detail"><p class="muted">Changes you were quizzed on:</p>${changes}</div>
</details>`;
    })
    .join('\n');
  return `<section>
  <h2>Concepts</h2>
  ${hint}
  ${items}
</section>`;
}

function conceptRow(concept: ConceptSummary): string {
  const level = masteryLevel(concept.score);
  const percent = Math.round(concept.score * 100);
  const tries = `${concept.attempts} ${concept.attempts === 1 ? 'try' : 'tries'}`;
  return `<div class="concept" title="${LEVEL_LABEL[level]}: ${concept.correct} of ${concept.attempts} fully correct">
  <div class="concept-head"><span class="name">${escape(concept.name)}</span><span class="muted">${percent}% · ${tries}</span></div>
  <div class="bar"><div class="fill ${level}" data-percent="${percent}"></div></div>
</div>`;
}

function activitySection(
  activity: ActivityEntry[],
  hunks: Record<string, HunkRef>,
  now: number,
): string {
  if (activity.length === 0) {
    return '';
  }
  const rows = activity
    .slice(0, RECENT_ACTIVITY)
    .map((a) => {
      const outcome = OUTCOME[a.outcome];
      const hunk = hunks[a.hunkId];
      const line = a.line ?? hunk?.line;
      const facts = [
        a.answer !== undefined ? fact('✍️ Your answer', escape(a.answer)) : '',
        a.feedback ? fact(`${outcome.icon} ${outcome.label}`, withInlineCode(a.feedback)) : '',
        a.expected && a.outcome !== 'correct'
          ? fact('📝 A good answer', withInlineCode(a.expected))
          : '',
        a.remember ? fact('💡 Remember', withInlineCode(a.remember)) : '',
      ].join('');
      return `<details class="activity" data-key="${escape(`a:${a.at}:${a.hunkId}`)}">
  <summary>
    <span class="icon" title="${outcome.label}">${outcome.icon}</span>
    <span class="text"><span class="question">${withInlineCode(a.question)}</span><span class="muted">${escape(a.concept)} · ${escape(basename(a.filePath))} · ${timeAgo(a.at, now)}</span></span>
  </summary>
  <div class="detail">
    <p class="full-question">${withInlineCode(a.question)}</p>
    ${facts}
    ${hunk ? diffBlock(hunk.diff) : ''}
    ${line ? openFileButton(a.filePath, line) : ''}
  </div>
</details>`;
    })
    .join('\n');
  return `<section>
  <h2>Recent activity</h2>
  ${rows}
</section>`;
}

function fact(label: string, html: string): string {
  return `<p class="fact"><strong>${label}:</strong> ${html}</p>`;
}

/** A unified diff with added and removed lines colored. */
export function diffBlock(diff: string): string {
  const lines = diff.split('\n').map((line) => {
    const kind = line.startsWith('+')
      ? 'add'
      : line.startsWith('-')
        ? 'del'
        : line.startsWith('@@')
          ? 'hunk'
          : 'ctx';
    return `<span class="${kind}">${escape(line) || ' '}</span>`;
  });
  return `<pre class="diff">${lines.join('\n')}</pre>`;
}

function openFileButton(filePath: string, line: number): string {
  return `<button class="link" data-action="openFile" data-file="${escape(filePath)}" data-line="${line}">Open ${escape(basename(filePath))}:${line}</button>`;
}

function footer(): string {
  return `<footer>
  <p class="muted">Scores weight recent answers most: an answer counts half as much after 14 days. Stored only on this machine.</p>
  <button class="link danger" data-action="reset">Reset progress</button>
</footer>`;
}

/** Escapes text, then shows Markdown `code` spans as code (their contents are already escaped). */
function withInlineCode(text: string): string {
  return escape(text).replace(/`([^`]+)`/g, '<code>$1</code>');
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
body { padding: 0 12px 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; margin: 18px 0 8px; color: var(--vscode-descriptionForeground); font-weight: 600; }
section:first-child h2 { margin-top: 12px; }
.muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
p { margin: 4px 0 8px; line-height: 1.4; }
.hint { margin-bottom: 6px; }
.tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.tile { border: 1px solid var(--vscode-panel-border, transparent); background: var(--vscode-editorWidget-background); border-radius: 8px; padding: 10px; }
.tile .value { font-size: 20px; font-weight: 700; }
.tile .label { color: var(--vscode-descriptionForeground); font-size: 11px; margin-top: 2px; }
details { border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,.15)); }
details details { border-bottom: none; }
summary { list-style: none; cursor: pointer; display: flex; gap: 8px; align-items: flex-start; padding: 6px 2px; border-radius: 6px; }
summary::-webkit-details-marker { display: none; }
summary:hover { background: var(--vscode-list-hoverBackground); }
summary::before { content: '›'; color: var(--vscode-descriptionForeground); transition: transform .1s; width: 8px; flex: none; }
details[open] > summary::before { transform: rotate(90deg); }
.detail { padding: 2px 4px 10px 18px; }
.concept { flex: 1; min-width: 0; }
.concept-head { display: flex; justify-content: space-between; gap: 8px; }
.concept .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar { height: 6px; border-radius: 3px; background: var(--vscode-editorWidget-background); margin-top: 4px; overflow: hidden; }
.fill { height: 100%; border-radius: 3px; }
.fill.weak { background: var(--vscode-charts-red, #E5484D); }
.fill.shaky { background: var(--vscode-charts-yellow, #F5A524); }
.fill.solid { background: #1FAA6E; }
.change summary { padding: 3px 2px; }
.file { font-family: var(--vscode-editor-font-family); font-size: 12px; }
.activity .icon { flex: none; }
.activity .text { display: flex; flex-direction: column; min-width: 0; }
.activity .question { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.full-question { font-weight: 600; }
.fact { font-size: 12px; }
code { font-family: var(--vscode-editor-font-family); font-size: .92em; background: var(--vscode-textCodeBlock-background); border-radius: 3px; padding: 0 3px; }
pre.diff { margin: 6px 0; padding: 6px 0; overflow-x: auto; background: var(--vscode-textCodeBlock-background); border-radius: 6px; font-family: var(--vscode-editor-font-family); font-size: 11.5px; line-height: 1.45; }
pre.diff span { display: block; padding: 0 8px; white-space: pre; }
pre.diff .add { background: var(--vscode-diffEditor-insertedLineBackground, rgba(31,170,110,.18)); }
pre.diff .del { background: var(--vscode-diffEditor-removedLineBackground, rgba(229,72,77,.18)); }
pre.diff .hunk { color: var(--vscode-descriptionForeground); }
button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; text-align: left; }
.link { color: var(--vscode-textLink-foreground); font-size: 12px; }
.link:hover { text-decoration: underline; }
.danger { color: var(--vscode-errorForeground); }
footer { margin-top: 20px; }
.empty { text-align: center; padding: 24px 8px; }
.empty-icon { font-size: 32px; }
.empty h2 { text-transform: none; letter-spacing: 0; font-size: 14px; color: var(--vscode-foreground); }
`;

// Bar widths are set here because the CSP blocks inline style attributes.
// Open sections are remembered in the webview state so refreshes keep them open.
const SCRIPT = `
const vscode = acquireVsCodeApi();
for (const fill of document.querySelectorAll('.fill')) {
  fill.style.width = Math.max(Number(fill.dataset.percent), 3) + '%';
}
const open = new Set((vscode.getState() || {}).open || []);
for (const details of document.querySelectorAll('details[data-key]')) {
  if (open.has(details.dataset.key)) details.open = true;
  details.addEventListener('toggle', () => {
    if (details.open) open.add(details.dataset.key); else open.delete(details.dataset.key);
    vscode.setState({ open: [...open] });
  });
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  event.preventDefault();
  vscode.postMessage({
    action: target.dataset.action,
    filePath: target.dataset.file,
    line: Number(target.dataset.line),
  });
});
`;
