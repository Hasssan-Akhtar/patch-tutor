import { describe, expect, it } from 'vitest';
import type { Explanation } from '../../src/llm/schemas';
import { explanationMarkdown, rawExplanationMarkdown } from '../../src/ui/explanationMarkdown';

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
  it('renders sections in order, risks, concepts and depth', () => {
    const md = explanationMarkdown(explanation, false);

    expect(md.indexOf('**Makes `total` async.**')).toBe(0);
    expect(md.indexOf('#### What changed')).toBeLessThan(md.indexOf('#### How it works'));
    expect(md.indexOf('#### How it works')).toBeLessThan(md.indexOf('#### Why it works'));
    expect(md).toContain('#### Watch out for\n- Callers must await.');
    expect(md).toContain('Concepts: `async-await` `promises`');
    expect(md).toContain('Deeper explanation');
    expect(md).not.toContain('cached');
  });

  it('omits empty risks and concepts, and marks cached results', () => {
    const md = explanationMarkdown({ ...explanation, risks: [], concepts: [] }, true);

    expect(md).not.toContain('Watch out for');
    expect(md).not.toContain('Concepts:');
    expect(md).toContain('Deeper explanation · cached');
  });
});

describe('rawExplanationMarkdown', () => {
  it('shows the raw reply with a note', () => {
    expect(rawExplanationMarkdown('  plain text  ')).toMatch(/^plain text\n\n---\n_The model/);
  });
});
