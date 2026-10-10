import { describe, expect, it } from 'vitest';
import { fitToBudget, truncateLines, type ContextSection } from '../../src/context/budget';
import { estimateTokens } from '../../src/context/tokens';

const lines = (n: number, width = 20) =>
  Array.from({ length: n }, (_, i) => `${i}`.padEnd(width, 'x')).join('\n');

describe('estimateTokens', () => {
  it('counts about four characters per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('fitToBudget', () => {
  const section = (title: string, priority: number, text = lines(4)): ContextSection => ({
    title,
    priority,
    text,
  });

  it('keeps everything when it fits, in original order', () => {
    const sections = [section('low', 1), section('high', 9)];

    const result = fitToBudget(sections, 1000);

    expect(result.kept.map((s) => s.title)).toEqual(['low', 'high']);
    expect(result.dropped).toEqual([]);
    expect(result.tokens).toBe(sections.reduce((n, s) => n + estimateTokens(s.text), 0));
  });

  it('drops the lowest-priority sections first', () => {
    const sections = [section('a', 3), section('b', 1), section('c', 2)];
    const one = estimateTokens(sections[0]?.text ?? '');

    const result = fitToBudget(sections, one * 2);

    expect(result.kept.map((s) => s.title)).toEqual(['a', 'c']);
    expect(result.dropped).toEqual(['b']);
  });

  it('truncates a truncatable section instead of dropping it', () => {
    const big = { ...section('enclosing', 10, lines(200)), truncatable: true };

    const result = fitToBudget([big], 200);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0]?.text).toMatch(/… \(truncated\)$/);
    expect(result.tokens).toBeLessThanOrEqual(200);
  });

  it('never exceeds the budget', () => {
    const sections = [
      { ...section('a', 5, lines(100)), truncatable: true },
      section('b', 4, lines(30)),
      section('c', 3, lines(30)),
    ];

    expect(fitToBudget(sections, 500).tokens).toBeLessThanOrEqual(500);
  });
});

describe('truncateLines', () => {
  it('returns the text unchanged when it fits', () => {
    expect(truncateLines('a\nb', 100)).toBe('a\nb');
  });

  it('gives up when fewer than 10 lines would remain', () => {
    expect(truncateLines(lines(50), 20)).toBeUndefined();
  });
});
