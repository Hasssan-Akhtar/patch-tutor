import { describe, expect, it } from 'vitest';
import explainPrompt from '../../src/prompts/explain.md';

// Each rule exists because a real explanation got it wrong; see the eval
// fixtures in test/fixtures/diffs/ that reproduce them.
describe('explain prompt', () => {
  it('treats comments as claims to check, not facts', () => {
    expect(explainPrompt).toMatch(/comments?[^.]*claims?/i);
    expect(explainPrompt).toContain('the comment says');
  });

  it('forbids performance claims that were not checked against the diff', () => {
    expect(explainPrompt).toMatch(/count the calls/i);
    expect(explainPrompt).toMatch(/fewer calls/i);
  });

  it('asks for every change in the hunk, as a list when there are several', () => {
    expect(explainPrompt).toMatch(/every (distinct )?change/i);
    expect(explainPrompt).toMatch(/bullet/i);
  });

  it('checks the risks that were missed, and never lists the handled case as a risk', () => {
    for (const risk of [/old default/i, /tie-breaker/i, /sibling|related (methods|functions)/i, /empty/i]) {
      expect(explainPrompt).toMatch(risk);
    }
    expect(explainPrompt).toMatch(/case the change handles/i);
  });

  it('ties concepts to what the change does', () => {
    expect(explainPrompt).toMatch(/`async-await`[^.]*only when the change/i);
    expect(explainPrompt).toMatch(/`input-validation`[^.]*only when/i);
  });

  it('knows the other hunks are context only', () => {
    expect(explainPrompt).toMatch(/other changes in (this|the same) file/i);
  });

  it('ends with a short self-check just before the output format', () => {
    const check = explainPrompt.indexOf('Before you reply');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(explainPrompt.indexOf('Reply with only a JSON object'));
  });
});
