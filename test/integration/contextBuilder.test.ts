import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { buildHunkContext } from '../../src/context/contextBuilder';
import { parseUnifiedDiff } from '../../src/git/diffParser';
import type { HunkContext } from '../../src/services/explainService';

const ORIGINAL = `function applyTax(amount) {
  return amount * 1.2;
}

function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}

module.exports = { total };
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

suite('contextBuilder', () => {
  let dir: string;

  suiteSetup(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-context-'));
    git(dir, 'init', '-q');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '^5' } }));
    writeFileSync(join(dir, 'cart.js'), ORIGINAL);
    git(dir, 'add', '-A');
    writeFileSync(
      join(dir, 'cart.js'),
      ORIGINAL.replace('sum += item.price;', 'sum += applyTax(item.price);'),
    );
  });

  suiteTeardown(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('collects the enclosing function, used definitions and frameworks', async function () {
    this.timeout(60000);
    const [hunk] = parseUnifiedDiff(git(dir, 'diff'));
    assert.ok(hunk, 'expected one hunk');
    const root = vscode.Uri.file(dir);

    // The TypeScript server needs a moment to start, so retry until it answers.
    let context: HunkContext | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      context = await buildHunkContext(hunk, root, 6000);
      if (context.sections.length >= 2) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(context);

    assert.strictEqual(context.languageId, 'javascript');
    assert.deepStrictEqual(context.frameworks, ['Express']);
    assert.strictEqual(context.diff, hunk.raw);

    const titles = context.sections.map((s) => s.title);
    const enclosing = context.sections.find((s) => s.title.startsWith('Enclosing code'));
    assert.ok(enclosing, `no enclosing section in ${JSON.stringify(titles)}`);
    assert.match(enclosing.text, /^function total\(items\)/);

    const definition = context.sections.find((s) => s.title.includes('`applyTax`'));
    assert.ok(definition, `no applyTax definition in ${JSON.stringify(titles)}`);
    assert.match(definition.text, /return amount \* 1\.2/);
  });

  test('drops context to respect a tiny budget', async () => {
    const [hunk] = parseUnifiedDiff(git(dir, 'diff'));
    assert.ok(hunk);

    const context = await buildHunkContext(hunk, vscode.Uri.file(dir), 60);

    assert.ok(context.dropped.length > 0, 'expected something to be dropped');
  });
});
