import { describe, expect, it } from 'vitest';
import type { ActivityEntry, ConceptSummary } from '../../src/learning/conceptStore';
import { progressStats, timeAgo } from '../../src/learning/stats';
import {
  dashboardHtml,
  diffBlock,
  type DashboardModel,
} from '../../src/ui/dashboard/dashboardHtml';

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Local noon, so day boundaries in any time zone do not shift the tests.
const NOW = new Date(2026, 9, 11, 12, 0, 0).getTime();

const entry = (over: Partial<ActivityEntry>): ActivityEntry => ({
  at: NOW,
  concept: 'closures',
  outcome: 'correct',
  question: 'What does it return?',
  filePath: 'src/cart.js',
  hunkId: 'h1',
  ...over,
});

describe('progressStats', () => {
  const attempt = (credit: number, daysAgo = 0) => ({ at: NOW - daysAgo * DAY, credit });

  it('reports the lifetime count and accuracy and today from scored attempts', () => {
    const stats = progressStats(
      {
        answeredTotal: 57,
        attempts: [attempt(1), attempt(0.5), attempt(0), attempt(0, 40)],
      },
      NOW,
    );

    expect(stats.answered).toBe(57);
    expect(stats.answeredToday).toBe(3);
    // Last 30 days only: (1 + 0.5 + 0) / 3.
    expect(stats.accuracy).toBeCloseTo(0.5);
  });

  it('counts a streak ending today or yesterday', () => {
    const days = (...ago: number[]) => ({
      answeredTotal: ago.length,
      attempts: ago.map((d) => attempt(1, d)),
    });

    expect(progressStats(days(0, 1, 2, 4), NOW).streakDays).toBe(3);
    expect(progressStats(days(1, 2), NOW).streakDays).toBe(2);
    expect(progressStats(days(2, 3), NOW).streakDays).toBe(0);
    expect(progressStats({ answeredTotal: 0, attempts: [] }, NOW)).toEqual({
      answered: 0,
      accuracy: undefined,
      streakDays: 0,
      answeredToday: 0,
    });
  });
});

describe('timeAgo', () => {
  it('reads naturally', () => {
    expect(timeAgo(NOW - 10 * 1000, NOW)).toBe('just now');
    expect(timeAgo(NOW - 5 * MIN, NOW)).toBe('5m ago');
    expect(timeAgo(NOW - 3 * 60 * MIN, NOW)).toBe('3h ago');
    expect(timeAgo(NOW - DAY, NOW)).toBe('yesterday');
    expect(timeAgo(NOW - 4 * DAY, NOW)).toBe('4d ago');
  });
});

describe('dashboardHtml', () => {
  const security = { nonce: 'abc123', cspSource: 'vscode-webview://x' };
  const ref = {
    hunkId: 'h1',
    filePath: 'src/cart.js',
    line: 4,
    diff: '@@ -1 +1 @@\n-old\n+new',
    lastSeen: NOW,
  };
  const concept = (name: string, score: number): ConceptSummary => ({
    name,
    score,
    attempts: 2,
    correct: 1,
    lastSeen: NOW,
    hunks: [ref],
  });
  const model = (over: Partial<DashboardModel> = {}): DashboardModel => ({
    stats: progressStats({ answeredTotal: 1, attempts: [{ at: NOW, credit: 1 }] }, NOW),
    concepts: [concept('async-await', 0.25), concept('closures', 0.9)],
    activity: [entry({})],
    hunks: { h1: ref },
    now: NOW,
    ...over,
  });

  it('shows a friendly empty state before any quiz', () => {
    const html = dashboardHtml(model({ concepts: [], activity: [] }), security);

    expect(html).toContain('No quiz results yet');
    expect(html).not.toContain('Recent activity');
  });

  it('shows stats, one concepts list with a practice hint, and recent activity', () => {
    const html = dashboardHtml(model(), security);

    expect(html).toContain('Your progress');
    expect(html).toContain('🎯 Practice next: <strong>async-await</strong>');
    expect(html.match(/<h2>Concepts<\/h2>/g)).toHaveLength(1);
    expect(html).not.toContain('All concepts');
    expect(html).toContain('Recent activity');
    expect(html).toContain('data-percent="25"');
    expect(html).toContain('class="fill weak"');
    expect(html).toContain('data-action="reset"');
  });

  it('expands activity in place with the answer, feedback, a good answer and the diff', () => {
    const html = dashboardHtml(
      model({
        activity: [
          entry({
            outcome: 'partly',
            answer: 'it waits',
            feedback: 'Close: `await` pauses.',
            expected: 'It waits for the promise.',
            remember: 'Await pauses the function.',
            line: 4,
          }),
        ],
      }),
      security,
    );

    expect(html).toContain('<details class="activity" data-key="a:');
    expect(html).toContain('✍️ Your answer:</strong> it waits');
    expect(html).toContain('Close: <code>await</code> pauses.');
    expect(html).toContain('📝 A good answer:</strong> It waits for the promise.');
    expect(html).toContain('💡 Remember:</strong> Await pauses the function.');
    expect(html).toContain('<span class="del">-old</span>');
    expect(html).toContain('<span class="add">+new</span>');
    expect(html).toContain('data-action="openFile" data-file="src/cart.js" data-line="4"');
    // Nothing opens an untitled editor any more.
    expect(html).not.toContain('openHunk');
  });

  it('hides "a good answer" when the answer was correct', () => {
    const html = dashboardHtml(
      model({ activity: [entry({ outcome: 'correct', expected: 'E.', answer: 'a' })] }),
      security,
    );

    expect(html).not.toContain('A good answer');
  });

  it('lists the changes behind each concept with their diffs', () => {
    const html = dashboardHtml(model(), security);

    expect(html).toContain('data-key="c:async-await"');
    expect(html).toContain('data-key="h:async-await:h1"');
    expect(html).toContain('src/cart.js:4');
  });

  it('congratulates when every concept is solid', () => {
    const html = dashboardHtml(model({ concepts: [concept('closures', 0.9)] }), security);

    expect(html).toContain("Everything you've practised is solid");
    expect(html).not.toContain('Practice next');
  });

  it('escapes stored text, including model-written questions and your answers', () => {
    const html = dashboardHtml(
      model({
        activity: [
          entry({
            question: '<img src=https://e.x/t.png onerror=alert(1)>',
            answer: '<script>x</script>',
          }),
        ],
        concepts: [concept('<b>x</b>', 0.1)],
        hunks: { h1: { ...ref, diff: '+<iframe>' } },
      }),
      security,
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<script>x');
    expect(html).not.toContain('<iframe>');
    expect(html).toContain('&lt;img src=https://e.x/t.png');
  });

  it('shows backticked code as code, still escaped', () => {
    const html = dashboardHtml(
      model({ activity: [entry({ question: 'How does `await <T>` work?' })] }),
      security,
    );

    expect(html).toContain('How does <code>await &lt;T&gt;</code> work?');
  });

  it('locks the page down: no network, nonce-only scripts and styles', () => {
    const html = dashboardHtml(model(), security);

    expect(html).toContain(
      "default-src 'none'; style-src vscode-webview://x 'nonce-abc123'; script-src 'nonce-abc123';",
    );
    expect(html.match(/<script nonce="abc123">/g)).toHaveLength(1);
    expect(html).not.toMatch(/https?:\/\/(?!e\.x)/);
  });
});

describe('diffBlock', () => {
  it('colors added, removed and header lines', () => {
    expect(diffBlock('@@ -1 +1 @@\n x\n-a\n+b')).toBe(
      '<pre class="diff"><span class="hunk">@@ -1 +1 @@</span>\n<span class="ctx"> x</span>\n<span class="del">-a</span>\n<span class="add">+b</span></pre>',
    );
  });
});
