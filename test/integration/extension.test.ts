import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Patch Tutor extension', () => {
  test('registers the hello command', async () => {
    const extension = vscode.extensions.getExtension('patch-tutor.patch-tutor');
    assert.ok(extension, 'extension not found');
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('patchTutor.hello'));
  });
});
