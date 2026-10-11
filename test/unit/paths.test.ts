import { describe, expect, it } from 'vitest';
import { isInsidePath } from '../../src/context/paths';

describe('isInsidePath', () => {
  it('accepts files under the root and rejects siblings that share a prefix', () => {
    expect(isInsidePath('/repo/src/a.js', '/repo', false)).toBe(true);
    expect(isInsidePath('/repo-other/a.js', '/repo', false)).toBe(false);
  });

  it('ignores case where the file system does, such as a Windows drive letter', () => {
    expect(isInsidePath('/c:/Users/me/repo/a.js', '/C:/Users/me/repo', true)).toBe(true);
    expect(isInsidePath('/c:/Users/me/repo/a.js', '/C:/Users/me/repo', false)).toBe(false);
  });
});
