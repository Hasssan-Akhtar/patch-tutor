import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FollowUpFixtureSchema } from '../../src/dev/followUpEvals';
import { parseUnifiedDiff } from '../../src/git/diffParser';

const dir = join(__dirname, '..', 'fixtures', 'followups');
const fixtures = readdirSync(dir).filter((name) => name.endsWith('.json'));
const load = (name: string) =>
  FollowUpFixtureSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8')));

describe('follow-up eval fixtures', () => {
  it('has at least one revision case and one hold-your-ground case', () => {
    const expected = fixtures.map((name) => load(name).expectRevised);
    expect(expected).toContain(true);
    expect(expected).toContain(false);
  });

  it.each(fixtures)('%s is valid and its diff has exactly one hunk', (name) => {
    const hunks = parseUnifiedDiff(readFileSync(join(dir, load(name).diff), 'utf8'));
    expect(hunks).toHaveLength(1);
  });
});
