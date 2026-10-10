import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { parseUnifiedDiff } from '../../src/git/diffParser';
import { getCommitDiff, getGitApi, getStagedDiff, getUnstagedDiff } from '../../src/git/gitService';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

suite('Patch Tutor extension', () => {
  test('registers its commands', async () => {
    const extension = vscode.extensions.getExtension('patch-tutor.patch-tutor');
    assert.ok(extension, 'extension not found');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('patchTutor.listStagedHunks'));
  });
});

suite('gitService', () => {
  let dir: string;

  suiteSetup(() => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'a.js'), 'const a = 1;\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
  });

  suiteTeardown(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  async function openRepo() {
    const repository = await (await getGitApi()).openRepository(vscode.Uri.file(dir));
    assert.ok(repository, 'repository not opened');
    return repository;
  }

  test('reads staged and unstaged diffs separately', async () => {
    writeFileSync(join(dir, 'a.js'), 'const a = 2;\n');
    git(dir, 'add', 'a.js');
    writeFileSync(join(dir, 'b.js'), 'const b = 1;\n');
    git(dir, 'add', '-N', 'b.js');
    const repository = await openRepo();

    const staged = parseUnifiedDiff(await getStagedDiff(repository));
    const unstaged = parseUnifiedDiff(await getUnstagedDiff(repository));

    assert.deepStrictEqual(
      staged.map((h) => [h.filePath, h.added]),
      [['a.js', ['const a = 2;']]],
    );
    assert.deepStrictEqual(
      unstaged.map((h) => h.filePath),
      ['b.js'],
    );
  });

  test('reads the diff a commit introduced', async () => {
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'second');
    const sha = git(dir, 'rev-parse', 'HEAD');
    const repository = await openRepo();

    const hunks = parseUnifiedDiff(await getCommitDiff(repository, sha));

    assert.deepStrictEqual(hunks.map((h) => h.filePath).sort(), ['a.js', 'b.js']);
  });
});
