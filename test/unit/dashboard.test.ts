import { describe, expect, it } from 'vitest';
import type { ActivityEntry, ConceptSummary } from '../../src/learning/conceptStore';
import { progressStats, timeAgo } from '../../src/learning/stats';
import { dashboardHtml, type DashboardModel } from '../../src/ui/dashboard/dashboardHtml';

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
  it('counts answers, accuracy and today, ignoring skips', () => {
    const stats = progressStats(
      [
        entry({ outcome: 'correct' }),
        entry({ outcome: 'partly' }),
        entry({ outcome: 'revealed' }),
        entry({ outcome: 'skipped' }),
        entry({ outcome: 'wrong', at: NOW - 40 * DAY }),
      ],
      NOW,
    );

    expect(stats.answered).toBe(4);
    expect(stats.answeredToday).toBe(3);
    // Last 30 days only: (1 + 0.5 + 0) / 3.
    expect(stats.accuracy).toBeCloseTo(0.5);
  });

  it('counts a streak ending today or yesterday', () => {
    const days = (...ago: number[]) => ago.map((d) => entry({ at: NOW - d * DAY }));

    expect(progressStats(days(0, 1, 2, 4), NOW).streakDays).toBe(3);
    expect(progressStats(days(1, 2), NOW).streakDays).toBe(2);
    expect(progressStats(days(2, 3), NOW).streakDays).toBe(0);
    expect(progressStats([], NOW)).toEqual({
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
  const concept = (name: string, score: number): ConceptSummary => ({
    name,
    score,
    attempts: 2,
    correct: 1,
    lastSeen: NOW,
    hunks: [{ hunkId: 'h1', filePath: 'src/cart.js', line: 4, diff: '+x', lastSeen: NOW }],
  });
  const model = (over: Partial<DashboardModel> = {}): DashboardModel => ({
    stats: progressStats([entry({})], NOW),
    concepts: [concept('async-await', 0.25), concept('closures', 0.9)],
    activity: [entry({})],
    now: NOW,
    ...over,
  });

  it('shows a friendly empty state before any quiz', () => {
    const html = dashboardHtml(model({ concepts: [], activity: [] }), security);

    expect(html).toContain('No quiz results yet');
    expect(html).not.toContain('Recent activity');
  });

  it('shows stats, practice next, all concepts and recent activity', () => {
    const html = dashboardHtml(model(), security);

    expect(html).toContain('Your progress');
    expect(html).toContain('Practice next');
    expect(html).toContain('All concepts');
    expect(html).toContain('Recent activity');
    expect(html).toContain('data-percent="25"');
    expect(html).toContain('class="fill weak"');
    expect(html).toContain('data-action="openHunk" data-hunk="h1"');
    expect(html).toContain('data-action="reset"');
  });

  it('suggests only concepts that are not solid yet', () => {
    const html = dashboardHtml(model({ concepts: [concept('closures', 0.9)] }), security);

    expect(html).toContain("Everything you've practised is solid");
    expect(html).not.toContain('Practice next</h2>\n  <p class="muted">Concepts');
  });

  it('escapes stored text, including questions written by the model', () => {
    const html = dashboardHtml(
      model({
        activity: [entry({ question: '<img src=https://e.x/t.png onerror=alert(1)>' })],
        concepts: [concept('<b>x</b>', 0.1)],
      }),
      security,
    );

    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;img src=https://e.x/t.png');
  });

  it('locks the page down: no network, nonce-only scripts and styles', () => {
    const html = dashboardHtml(model(), security);

    expect(html).toContain(
      "default-src 'none'; style-src vscode-webview://x 'nonce-abc123'; script-src 'nonce-abc123';",
    );
    expect(html.match(/<script nonce="abc123">/g)).toHaveLength(1);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
