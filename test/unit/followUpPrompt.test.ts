import { describe, expect, it } from 'vitest';
import followUpPrompt from '../../src/prompts/follow-up.md';

// Each rule exists because a real follow-up went wrong with a small model.
describe('follow-up prompt', () => {
  it('asks for the mistake behind any revision, and none for plain questions', () => {
    expect(followUpPrompt).toContain('"mistake"');
    expect(followUpPrompt).toMatch(/questions?[^.]*(dry run|example|format)[^.]*never[^.]*revis/i);
  });

  it('follows the format the user asks for, code included', () => {
    expect(followUpPrompt).toMatch(/format they ask for/i);
    expect(followUpPrompt).toMatch(/code block/i);
    expect(followUpPrompt).not.toMatch(/one to five sentences/i);
  });

  it('has a template for dry runs that covers the branch not taken', () => {
    expect(followUpPrompt).toMatch(/dry run/i);
    expect(followUpPrompt).toMatch(/numbered steps/i);
    expect(followUpPrompt).toMatch(/other branch|branch not taken|throws/i);
  });
});
