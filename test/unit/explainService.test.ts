import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExplanationCache } from '../../src/cache/explanationCache';
import type { Hunk } from '../../src/git/hunk';
import type { LLMProvider } from '../../src/llm/provider';
import explainPrompt from '../../src/prompts/explain.md';
import {
  buildExplainUserMessage,
  ExplainService,
  type HunkContext,
} from '../../src/services/explainService';

const hunk: Hunk = {
  id: 'hunk-1',
  filePath: 'src/cart.js',
  status: 'modified',
  newStart: 1,
  newLines: 2,
  oldStart: 1,
  oldLines: 1,
  added: ['  return 0;'],
  removed: [],
  raw: '@@ -1,1 +1,2 @@\n function total() {\n+  return 0;',
};

const context: HunkContext = {
  languageId: 'javascript',
  frameworks: ['React'],
  sections: [{ title: 'Enclosing code (lines 1-3)', text: 'function total() {}', priority: 1 }],
  dropped: [],
  diff: hunk.raw,
};

const validReply = JSON.stringify({
  summary: 'Returns zero early.',
  whatChanged: 'Adds a return.',
  howItWorks: 'It returns 0.',
  whyItWorks: 'Nothing else runs.',
  concepts: ['edge-cases'],
  risks: [],
  depth: 'standard',
});

describe('ExplainService', () => {
  let dir: string;
  let complete: ReturnType<typeof vi.fn<LLMProvider['complete']>>;
  let service: ExplainService;
  let modelKey: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-explain-'));
    complete = vi.fn<LLMProvider['complete']>();
    modelKey = 'vscodeLm:default';
    service = new ExplainService({
      createProvider: () => ({ id: 'vscodeLm', name: 'fake', complete }),
      modelKey: () => modelKey,
      buildContext: async () => context,
      cache: new ExplanationCache(join(dir, 'cache.json')),
      maxOutputTokens: () => 1200,
    });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('sends the explain prompt and the hunk, and returns the validated explanation', async () => {
    complete.mockResolvedValue(validReply);

    const result = await service.explainHunk(hunk, 'standard');

    expect(result).toEqual({
      kind: 'explanation',
      explanation: JSON.parse(validReply),
      fromCache: false,
    });
    const request = complete.mock.calls[0]?.[0];
    expect(request?.system).toBe(explainPrompt);
    expect(request?.user).toContain('+  return 0;');
    expect(request?.maxTokens).toBe(1200);
  });

  it('serves repeat requests from the cache', async () => {
    complete.mockResolvedValue(validReply);

    await service.explainHunk(hunk, 'standard');
    const second = await service.explainHunk(hunk, 'standard');

    expect(second).toMatchObject({ kind: 'explanation', fromCache: true });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('bypasses the cache when asked', async () => {
    complete.mockResolvedValue(validReply);

    await service.explainHunk(hunk, 'standard');
    const fresh = await service.explainHunk(hunk, 'standard', undefined, { skipCache: true });

    expect(fresh).toMatchObject({ kind: 'explanation', fromCache: false });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not reuse the cache across depths or models', async () => {
    complete.mockResolvedValue(validReply);

    await service.explainHunk(hunk, 'standard');
    await service.explainHunk(hunk, 'deep');
    modelKey = 'vscodeLm:other';
    await service.explainHunk(hunk, 'standard');

    expect(complete).toHaveBeenCalledTimes(3);
  });

  it('returns raw text when the model never produces valid JSON, and does not cache it', async () => {
    complete.mockResolvedValue('I think this adds an early return.');

    const result = await service.explainHunk(hunk, 'standard');
    await service.explainHunk(hunk, 'standard');

    expect(result).toMatchObject({ kind: 'raw', text: 'I think this adds an early return.' });
    expect(complete).toHaveBeenCalledTimes(4);
  });
});

describe('buildExplainUserMessage', () => {
  it('includes depth, file, language, frameworks, diff and context sections', () => {
    const message = buildExplainUserMessage(hunk, 'simple', context);

    expect(message).toContain('Depth: simple');
    expect(message).toContain('File: src/cart.js (modified)');
    expect(message).toContain('Language: javascript');
    expect(message).toContain('Frameworks: React');
    expect(message).toContain('```diff\n' + hunk.raw);
    expect(message).toContain('### Enclosing code (lines 1-3)');
    expect(message).not.toMatch(/\{\{\w+\}\}/);
  });

  it('says when there is no extra context', () => {
    const message = buildExplainUserMessage(hunk, 'standard', {
      ...context,
      frameworks: [],
      sections: [],
    });

    expect(message).toContain('Frameworks: none detected');
    expect(message).toContain('(no additional context available)');
  });

  it('shows both paths for renames', () => {
    const message = buildExplainUserMessage(
      { ...hunk, status: 'renamed', oldPath: 'src/old.js' },
      'standard',
      context,
    );

    expect(message).toContain('File: src/old.js -> src/cart.js (renamed)');
  });
});
