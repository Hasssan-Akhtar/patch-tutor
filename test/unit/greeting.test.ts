import { describe, expect, it } from 'vitest';
import { greeting } from '../../src/greeting';

describe('greeting', () => {
  it('names the extension', () => {
    expect(greeting()).toContain('Patch Tutor');
  });
});
