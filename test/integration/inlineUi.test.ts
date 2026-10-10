import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { PatchTutorTestApi } from '../../src/extension';
import { getGitApi } from '../../src/git/gitService';

// Padding keeps the two working-tree changes more than git's 3 context lines apart,
// so they become separate hunks.
const PADDING = Array.from({ length: 8 }, (_, i) => `// note ${i + 1}`);
const ORIGINAL = [
  ...PADDING,
  'function total(items) {',
  '  let sum = 0;',
  '  return sum;',
  '}',
  '',
].join('\n');
// A per-run token makes the hunk new each run, so the explanation cache cannot answer it.
const RUN = Date.now().toString(36);
const ADDED_LINE = `  sum += items.length; // run ${RUN}`;
const STAGED = ORIGINAL.replace('  let sum = 0;', `  let sum = 0;\n${ADDED_LINE}`);
const WORKING = STAGED.replace('// note 1', '// totals\n// note 1');

const QUIZ = {
  questions: [1, 2, 3].map((n) => ({
    id: `q${n}`,
    type: 'predict',
    question: `Question number ${n}?`,
    concept: 'array-methods',
    expected: `Answer ${n}.`,
  })),
};
const GRADE = {
  verdict: 'correct',
  feedback: 'Exactly right.',
  missed: [],
  remember: 'Arrays know their length.',
};

const EXPLANATION = {
  summary: 'Counts the items.',
  whatChanged: 'Adds the item count to the sum.',
  howItWorks: 'Uses `items.length`.',
  whyItWorks: 'Arrays have a length.',
  concepts: ['array-methods'],
  risks: [],
  depth: 'standard',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function waitFor<T>(read: () => Promise<T | undefined>, what: string): Promise<T> {
  for (let i = 0; i < 50; i++) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

suite('inline UI', () => {
  let dir: string;
  let file: vscode.Uri;
  let api: PatchTutorTestApi;
  const requests: string[] = [];

  suiteSetup(async () => {
    dir = mkdtempSync(join(tmpdir(), 'patch-tutor-inline-'));
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'user.email', 'test@example.com');
    git(dir, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(dir, 'cart.js'), ORIGINAL);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    writeFileSync(join(dir, 'cart.js'), STAGED);
    git(dir, 'add', 'cart.js');
    writeFileSync(join(dir, 'cart.js'), WORKING);
    file = vscode.Uri.file(join(dir, 'cart.js'));

    const extension = vscode.extensions.getExtension<PatchTutorTestApi>('patch-tutor.patch-tutor');
    assert.ok(extension);
    api = await extension.activate();
    api.setProviderOverride({
      id: 'vscodeLm',
      name: 'Fake',
      complete: async (request) => {
        requests.push(request.user);
        if (request.system.includes('grading')) {
          return JSON.stringify(GRADE);
        }
        if (request.system.includes('writing a short quiz')) {
          return JSON.stringify(QUIZ);
        }
        return JSON.stringify(EXPLANATION);
      },
    });
    await (await getGitApi()).openRepository(vscode.Uri.file(dir));
  });

  suiteTeardown(async () => {
    api.setProviderOverride(undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    rmSync(dir, { recursive: true, force: true });
  });

  test('shows CodeLens on the changed lines of the working tree file', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);

    const lenses = await waitFor(async () => {
      const found = await vscode.commands.executeCommand<vscode.CodeLens[]>(
        'vscode.executeCodeLensProvider',
        file,
      );
      const ours = found.filter((l) => l.command?.command.startsWith('patchTutor.'));
      return ours.length >= 2 ? ours : undefined;
    }, 'Patch Tutor CodeLens');

    // WORKING has two separate changes vs HEAD: the comment on line 1 and the new line 12.
    const lines = [...new Set(lenses.map((l) => l.range.start.line))].sort((a, b) => a - b);
    assert.deepStrictEqual(lines, [0, 11]);
    assert.deepStrictEqual(lenses.map((l) => l.command?.title).slice(0, 2), [
      '$(lightbulb) Explain this change',
      '$(mortar-board) Quiz me',
    ]);
  });

  test('hovering a changed line offers Explain and Quiz me', async () => {
    const hoverText = async (line: number) => {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        file,
        new vscode.Position(line, 2),
      );
      return hovers
        .flatMap((h) => h.contents)
        .map((c) => (c instanceof vscode.MarkdownString ? c.value : String(c)))
        .join('\n');
    };

    const onChange = await hoverText(11);
    assert.match(onChange, /command:patchTutor\.explainHunk\?/);
    assert.match(onChange, /command:patchTutor\.quizHunk\?/);
    assert.doesNotMatch(await hoverText(5), /patchTutor/);
  });

  test('Explain opens a comment thread on the hunk with the explanation', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const result = await api.hunks.getHunks(document);
    const hunk = result?.hunks.find((h) => h.added.includes(ADDED_LINE));
    assert.ok(hunk, 'expected the sum hunk');

    await vscode.commands.executeCommand('patchTutor.explainHunk', file, hunk.id);

    const [thread, ...others] = api.threads.threadsFor(file);
    assert.ok(thread, 'expected a thread');
    assert.strictEqual(others.length, 0);
    assert.strictEqual(thread.range?.start.line, 11);
    assert.strictEqual(thread.range?.end.line, 11);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard');
    const body = thread.comments[0]?.body;
    assert.ok(body instanceof vscode.MarkdownString);
    assert.match(body.value, /\*\*TL;DR:\*\* Counts the items\./);
    assert.strictEqual(thread.label, '💡 Counts the items.');
    assert.ok(requests.some((r) => r.includes(`+${ADDED_LINE}`)));

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
    assert.strictEqual(api.threads.threadsFor(file).length, 0);
  });

  test('Quiz me asks questions one at a time, grades answers and summarizes', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const hunk = (await api.hunks.getHunks(document))?.hunks.find((h) =>
      h.added.includes(ADDED_LINE),
    );
    assert.ok(hunk);
    const bodies = (thread: vscode.CommentThread) =>
      thread.comments.map((c) => (c.body instanceof vscode.MarkdownString ? c.body.value : c.body));

    await vscode.commands.executeCommand('patchTutor.explainHunk', file, hunk.id);
    await vscode.commands.executeCommand('patchTutor.quizHunk', file, hunk.id);

    const [thread] = api.threads.threadsFor(file);
    assert.ok(thread);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard quiz');
    assert.strictEqual(thread.canReply, true);
    assert.match(bodies(thread)[0] ?? '', /TL;DR/, 'explanation stays first');
    assert.match(bodies(thread).at(-1) ?? '', /Question 1 of 3/);

    await vscode.commands.executeCommand('patchTutor.quiz.submit', {
      thread,
      text: 'It adds the count',
    });
    assert.strictEqual(thread.comments.at(-2)?.author.name, 'You');
    // Feedback and the next question arrive as one comment.
    assert.match(bodies(thread).at(-1) ?? '', /Nailed it![\s\S]*Question 2 of 3/);
    assert.ok(requests.some((r) => r.includes('It adds the count') && r.includes('Answer 1.')));

    await vscode.commands.executeCommand('patchTutor.quiz.showAnswer', { thread, text: '' });
    assert.match(bodies(thread).at(-1) ?? '', /Answer 2\.[\s\S]*Question 3 of 3/);

    await vscode.commands.executeCommand('patchTutor.quiz.skip', { thread, text: '' });
    assert.match(
      bodies(thread).at(-1) ?? '',
      /Quiz done![\s\S]*1\/1 correct[\s\S]*peeked at 1, skipped 1/,
    );
    assert.strictEqual(thread.canReply, false);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard');

    await vscode.commands.executeCommand('patchTutor.thread.reportWrong', thread);
    assert.match(bodies(thread).at(-1) ?? '', /Thanks for flagging this/);

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
  });

  test('finds staged hunks on the index side of the diff editor', async () => {
    const indexUri = file.with({
      scheme: 'git',
      query: JSON.stringify({ path: file.fsPath, ref: '' }),
    });
    const document = await vscode.workspace.openTextDocument(indexUri);
    assert.strictEqual(document.getText(), STAGED);

    const result = await api.hunks.getHunks(document);

    assert.deepStrictEqual(
      result?.hunks.map((h) => h.added),
      [[ADDED_LINE]],
    );
  });
});
