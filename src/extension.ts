import * as vscode from 'vscode';
import { greeting } from './greeting';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('patchTutor.hello', () => {
      void vscode.window.showInformationMessage(greeting());
    }),
  );
}

export function deactivate(): void {}
