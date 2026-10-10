import * as vscode from 'vscode';
import { changedLineRange } from '../context/hunkLines';
import type { Hunk } from '../git/hunk';

/** Editor range covering the lines a hunk changes, clamped to the document. */
export function hunkRange(hunk: Hunk, document: vscode.TextDocument): vscode.Range {
  const { start, end } = changedLineRange(hunk);
  const last = Math.max(document.lineCount - 1, 0);
  const startLine = Math.min(start - 1, last);
  const endLine = Math.min(Math.max(end - 1, startLine), last);
  return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
}
