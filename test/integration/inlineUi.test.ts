import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { PatchTutorTestApi } from '../../src/extension';
import { getGitApi } from '../../src/git/gitService';

// Padding keeps the two working-tree changes more than git's 3 context lines apart,
// so they become separate hunks.
import { makeTempDir, removeTempDir } from './tempDir';
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

function bodies(thread: vscode.CommentThread): string[] {
  return thread.comments.map((c) =>
    c.body instanceof vscode.MarkdownString ? c.body.value : c.body,
  );
}

suite('inline UI', () => {
  let dir: string;
  let file: vscode.Uri;
  let api: PatchTutorTestApi;
  const requests: string[] = [];
  let followUpReply: object = { answer: 'Because arrays know their length.' };

  suiteSetup(async () => {
    dir = makeTempDir('patch-tutor-inline-');
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
    await api.concepts.clear();
    await api.transcripts.clear();
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
        if (request.system.includes('follow-up question')) {
          return JSON.stringify(followUpReply);
        }
        return JSON.stringify(EXPLANATION);
      },
    });
    await (await getGitApi()).openRepository(vscode.Uri.file(dir));
  });

  suiteTeardown(async () => {
    api.setProviderOverride(undefined);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    removeTempDir(dir);
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
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard chat');
    const body = thread.comments[0]?.body;
    assert.ok(body instanceof vscode.MarkdownString);
    assert.match(body.value, /\*\*TL;DR:\*\* Counts the items\./);
    assert.strictEqual(thread.label, '💡 Counts the items.');
    assert.ok(requests.some((r) => r.includes(`+${ADDED_LINE}`)));
    // The file's other hunk is context, so the model knows about it without explaining it.
    const sent = requests.find((r) => r.includes(`+${ADDED_LINE}`)) ?? '';
    assert.match(sent, /### Other changes in this file[^\n]*\n\n```diff\n@@[^\n]*\n\+\/\/ totals/);

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
    assert.strictEqual(api.threads.threadsFor(file).length, 0);
  });

  test('Replying asks a follow-up; a correction revises the explanation; Refresh starts over', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const hunk = (await api.hunks.getHunks(document))?.hunks.find((h) =>
      h.added.includes(ADDED_LINE),
    );
    assert.ok(hunk);
    await vscode.commands.executeCommand('patchTutor.explainHunk', file, hunk.id);
    const [thread] = api.threads.threadsFor(file);
    assert.ok(thread);
    assert.strictEqual(thread.canReply, true);

    followUpReply = { answer: 'Because arrays know their `length`.' };
    await vscode.commands.executeCommand('patchTutor.chat.ask', { thread, text: 'Why length?' });
    // User comments are plain text, which VS Code escapes (spaces become &nbsp;).
    assert.match(bodies(thread).at(-2) ?? '', /Why(&nbsp;| )length\?/);
    assert.match(bodies(thread).at(-1) ?? '', /arrays know their/);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard chat started');
    assert.match(requests.at(-1) ?? '', /Why length\?/);

    followUpReply = {
      answer: 'You are right.',
      revised: { ...EXPLANATION, summary: 'Counts items in one pass.' },
    };
    await vscode.commands.executeCommand('patchTutor.chat.ask', { thread, text: 'Really?' });
    assert.match(bodies(thread)[0] ?? '', /Revised after your reply/);
    assert.match(bodies(thread)[0] ?? '', /Counts items in one pass/);
    assert.strictEqual(thread.label, '💡 Counts items in one pass.');
    assert.match(requests.at(-1) ?? '', /Developer: Why length\?/);

    // A quiz waiting for an answer owns the reply box.
    await vscode.commands.executeCommand('patchTutor.thread.quiz', thread);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard quiz');

    await vscode.commands.executeCommand('patchTutor.thread.refresh', thread);
    assert.doesNotMatch(bodies(thread)[0] ?? '', /Revised/);
    assert.match(bodies(thread)[0] ?? '', /Counts the items\./);
    assert.ok(!bodies(thread).some((b) => /Why(&nbsp;| )length/.test(b)), 'conversation cleared');

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
  });

  test('Quiz me asks questions one at a time, grades answers and summarizes', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const hunk = (await api.hunks.getHunks(document))?.hunks.find((h) =>
      h.added.includes(ADDED_LINE),
    );
    assert.ok(hunk);

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
    // Once the quiz is done, the reply box asks follow-ups about the explanation again.
    assert.strictEqual(thread.canReply, true);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard chat');

    // Progress: correct (1) + revealed (0) for the same concept; the skip is logged but not scored.
    const [concept, ...others] = await waitFor(async () => {
      const found = await api.concepts.summaries();
      return found[0]?.attempts === 2 ? found : undefined;
    }, 'concept results');
    assert.strictEqual(others.length, 0);
    assert.strictEqual(concept?.name, 'array-methods');
    // Attempts are milliseconds apart, so time decay moves the score a hair below 0.5.
    assert.ok(Math.abs((concept?.score ?? 0) - 0.5) < 0.001, `score ${concept?.score}`);
    assert.strictEqual(concept?.hunks[0]?.hunkId, hunk.id);

    // Answers are saved asynchronously; wait until the skip is logged too.
    const model = await waitFor(async () => {
      const m = await api.dashboard.model();
      return m.activity.length === 3 ? m : undefined;
    }, 'all three answers logged');
    assert.deepStrictEqual(
      model.activity.map((a) => a.outcome),
      ['skipped', 'revealed', 'correct'],
    );
    assert.strictEqual(model.stats.answered, 2);
    assert.strictEqual(model.stats.streakDays, 1);
    await vscode.commands.executeCommand('patchTutor.showProgress');

    // Activity keeps what was answered and the change, for showing in place.
    const graded = model.activity.find((a) => a.outcome === 'correct');
    assert.strictEqual(graded?.answer, 'It adds the count');
    assert.strictEqual(graded?.feedback, 'Exactly right.');
    assert.strictEqual(graded?.expected, 'Answer 1.');
    assert.ok(model.hunks[hunk.id]?.diff.includes(ADDED_LINE));

    // The finished quiz is saved to History with its whole conversation.
    const saved = await waitFor(async () => {
      const list = api.chat.state().history;
      return list.length > 0 && list[0]?.meta.startsWith('1/1 correct') ? list : undefined;
    }, 'quiz saved to history');
    await api.chat.openTranscript(saved[0]?.id ?? '');
    const viewing = api.chat.state().viewing;
    assert.strictEqual(viewing?.where, 'cart.js:12');
    assert.match(viewing?.messages.at(-1)?.html ?? '', /Quiz done!/);
    api.chat.showTab('quiz');

    await vscode.commands.executeCommand('patchTutor.thread.reportWrong', thread);
    assert.match(bodies(thread).at(-1) ?? '', /Thanks for flagging this/);

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
  });

  test('Move to chat continues the same quiz in the sidebar chat', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const hunk = (await api.hunks.getHunks(document))?.hunks.find((h) =>
      h.added.includes(ADDED_LINE),
    );
    assert.ok(hunk);
    await vscode.commands.executeCommand('patchTutor.quizHunk', file, hunk.id);
    const [thread] = api.threads.threadsFor(file);
    assert.ok(thread);
    await vscode.commands.executeCommand('patchTutor.quiz.submit', { thread, text: 'first' });

    await vscode.commands.executeCommand('patchTutor.quiz.moveToChat', { thread, text: '' });

    // The thread points to the chat and no longer takes answers.
    const last = thread.comments.at(-1)?.body;
    assert.ok(last instanceof vscode.MarkdownString);
    assert.match(last.value, /continues in the Patch Tutor chat/);
    assert.strictEqual(thread.canReply, false);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard');

    // The chat shows the same quiz, answers so far included.
    const quiz = api.chat.current;
    assert.ok(quiz && 'reveal' in quiz, 'expected a quiz');
    const state = api.chat.state();
    assert.strictEqual(state.tab, 'quiz');
    assert.strictEqual(state.quiz?.kind, 'quiz');
    assert.strictEqual(state.quiz?.file, 'cart.js');
    assert.strictEqual(state.quiz?.line, 12);
    assert.deepStrictEqual(
      state.quiz?.messages.map((m) => m.from),
      ['tutor', 'you', 'tutor'],
    );
    assert.match(state.quiz?.messages[2]?.html ?? '', /Question 2 of 3/);
    assert.strictEqual(state.quiz?.canAnswer, true);
    // History is saved asynchronously; the live quiz is marked "in chat" once it lands.
    await waitFor(
      async () =>
        api.chat.state().history.some((h) => h.id === quiz.id && h.current) ? true : undefined,
      'live quiz listed in history',
    );

    await api.chat.submit('second');
    quiz.reveal();
    assert.strictEqual(api.chat.state().quiz?.done, true);
    assert.match(api.chat.state().quiz?.messages.at(-1)?.html ?? '', /Quiz done!/);

    await api.chat.anotherRound();
    assert.notStrictEqual(api.chat.current, quiz);
    assert.match(api.chat.state().quiz?.messages.at(-1)?.html ?? '', /Question 1 of 3/);

    await vscode.commands.executeCommand('patchTutor.thread.dismiss', thread);
  });

  test('Move to chat continues a follow-up in the sidebar chat', async () => {
    const document = await vscode.workspace.openTextDocument(file);
    const hunk = (await api.hunks.getHunks(document))?.hunks.find((h) =>
      h.added.includes(ADDED_LINE),
    );
    assert.ok(hunk);
    await vscode.commands.executeCommand('patchTutor.explainHunk', file, hunk.id);
    const [thread] = api.threads.threadsFor(file);
    assert.ok(thread);
    followUpReply = { answer: 'First answer.' };
    await vscode.commands.executeCommand('patchTutor.chat.ask', { thread, text: 'First?' });

    await vscode.commands.executeCommand('patchTutor.chat.moveToChat', { thread, text: '' });

    assert.match(bodies(thread).at(-1) ?? '', /conversation continues in the Patch Tutor chat/);
    assert.strictEqual(thread.canReply, false);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard');
    const state = api.chat.state();
    assert.strictEqual(state.quiz?.kind, 'followUp');
    assert.match(state.quiz?.messages[0]?.html ?? '', /TL;DR/);
    assert.deepStrictEqual(
      state.quiz?.messages.map((m) => m.from),
      ['tutor', 'you', 'tutor'],
    );

    followUpReply = { answer: 'Second answer.' };
    await api.chat.submit('Second?');
    assert.match(api.chat.state().quiz?.messages.at(-1)?.html ?? '', /Second answer/);

    // When the sidebar moves on to something else, the thread takes follow-ups again.
    await vscode.commands.executeCommand('patchTutor.quizHunk', file, hunk.id);
    await vscode.commands.executeCommand('patchTutor.quiz.moveToChat', { thread, text: '' });
    assert.strictEqual(api.chat.state().quiz?.kind, 'quiz');
    assert.ok(!bodies(thread).some((b) => /conversation continues/.test(b)), 'pointer removed');
    assert.strictEqual(thread.canReply, true);
    assert.strictEqual(thread.contextValue, 'patchTutorThread standard chat');

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
