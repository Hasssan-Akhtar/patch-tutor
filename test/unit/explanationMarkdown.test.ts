import { describe, expect, it } from 'vitest';
import type { Explanation } from '../../src/llm/schemas';
import {
  escapeModelText,
  explanationMarkdown,
  rawExplanationMarkdown,
  threadTitle,
} from '../../src/ui/explanationMarkdown';

const explanation: Explanation = {
  summary: 'Makes `total` async.',
  whatChanged: 'W',
  howItWorks: 'H',
  whyItWorks: 'Y',
  concepts: ['async-await', 'promises'],
  risks: ['Callers must await.'],
  depth: 'deep',
};

describe('explanationMarkdown', () => {
  it('leads with a TL;DR and keeps sections in order', () => {
    const md = explanationMarkdown(explanation, false);

    expect(md.startsWith('> 💡 **TL;DR:** Makes `total` async.')).toBe(true);
    expect(md.indexOf('What changed')).toBeLessThan(md.indexOf('How it works'));
    expect(md.indexOf('How it works')).toBeLessThan(md.indexOf('Why it works'));
    expect(md.indexOf('Why it works')).toBeLessThan(md.indexOf('Watch out for'));
  });

  it('lists risks, shows concepts as pills, and nudges toward the quiz', () => {
    const md = explanationMarkdown(explanation, false);

    expect(md).toContain('- Callers must await.');
    expect(md).toMatch(/background-color:#[0-9A-F]{6};">&nbsp;async-await&nbsp;<\/span>/);
    expect(md).toContain('Quiz me');
    expect(md).toContain('🔬 Deep dive');
    expect(md).not.toContain('from cache');
  });

  it('celebrates when there are no risks, and marks cached results', () => {
    const md = explanationMarkdown({ ...explanation, risks: [], concepts: [] }, true);

    expect(md).toContain('Nothing risky spotted');
    expect(md).not.toContain('Watch out for');
    expect(md).not.toContain('🧠');
    expect(md).toContain('⚡ from cache');
  });

  it('escapes HTML and images coming from the model', () => {
    const md = explanationMarkdown(
      {
        ...explanation,
        whatChanged:
          'Adds <img src="https://example.com/x.png"> and ![t](https://example.com/t.png)',
        concepts: ['<b>bold</b>'],
      },
      false,
    );

    expect(md).not.toContain('<img');
    expect(md).not.toContain('![t]');
    expect(md).not.toContain('<b>');
    expect(md).toContain('&lt;img');
  });
});

describe('escapeModelText', () => {
  it('leaves code spans untouched', () => {
    expect(escapeModelText('use `a < b && <T>()` then <br>')).toBe(
      'use `a < b && <T>()` then &lt;br&gt;',
    );
    expect(escapeModelText('``x`y`` & z')).toBe('``x`y`` &amp; z');
  });
});

describe('threadTitle', () => {
  it('strips backticks and shortens long summaries', () => {
    expect(threadTitle(explanation)).toBe('💡 Makes total async.');
    expect(threadTitle({ ...explanation, summary: 'x'.repeat(200) })).toHaveLength(2 + 1 + 88);
  });
});

describe('rawExplanationMarkdown', () => {
  it('shows the escaped raw reply with a note', () => {
    expect(rawExplanationMarkdown('  <i>plain</i>  ')).toMatch(
      /^&lt;i&gt;plain&lt;\/i&gt;\n\n---\n/,
    );
  });
});
