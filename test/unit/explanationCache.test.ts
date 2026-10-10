import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheKey, ExplanationCache } from '../../src/cache/explanationCache';
import type { Explanation } from '../../src/llm/schemas';

const explanation = (summary: string): Explanation => ({
  summary,
  whatChanged: 'w',
  howItWorks: 'h',
  whyItWorks: 'y',
  concepts: ['closures'],
  risks: [],
  depth: 'standard',
});

const parts = { hunkId: 'abc', depth: 'standard', model: 'vscodeLm:default', promptVersion: 'p1' };

describe('cacheKey', () => {
  it('is stable and changes with every part', () => {
    const base = cacheKey({ ...parts, depth: 'standard' });

    expect(cacheKey({ ...parts, depth: 'standard' })).toBe(base);
    expect(cacheKey({ ...parts, depth: 'deep' })).not.toBe(base);
    expect(cacheKey({ ...parts, depth: 'standard', hunkId: 'other' })).not.toBe(base);
    expect(cacheKey({ ...parts, depth: 'standard', model: 'vscodeLm:gpt' })).not.toBe(base);
    expect(cacheKey({ ...parts, depth: 'standard', promptVersion: 'p2' })).not.toBe(base);
  });
});

describe('ExplanationCache', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-cache-'));
    file = join(dir, 'nested', 'explanations.json');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists entries across instances', async () => {
    await new ExplanationCache(file).set('k', explanation('saved'));

    expect(await new ExplanationCache(file).get('k')).toEqual(explanation('saved'));
    expect(await new ExplanationCache(file).get('missing')).toBeUndefined();
  });

  it('evicts the oldest entries past the limit', async () => {
    let clock = 0;
    const cache = new ExplanationCache(file, 2, () => ++clock);

    await cache.set('a', explanation('a'));
    await cache.set('b', explanation('b'));
    await cache.set('c', explanation('c'));

    const reloaded = new ExplanationCache(file);
    expect(await reloaded.get('a')).toBeUndefined();
    expect(await reloaded.get('b')).toBeDefined();
    expect(await reloaded.get('c')).toBeDefined();
  });

  it('starts empty when the file is corrupt', async () => {
    const cache = new ExplanationCache(file);
    await cache.set('k', explanation('x'));
    writeFileSync(file, '{ broken');

    expect(await new ExplanationCache(file).get('k')).toBeUndefined();
  });

  it('clears everything', async () => {
    const cache = new ExplanationCache(file);
    await cache.set('k', explanation('x'));

    await cache.clear();

    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, entries: {} });
  });
});
