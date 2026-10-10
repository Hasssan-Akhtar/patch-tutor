import * as vscode from 'vscode';
import { getProviderId, PROVIDERS } from '../services/providerService';
import { addUsage, formatTokens, localDay, tokensToday, type DailyUsage } from '../services/usage';

const USAGE_KEY = 'patchTutor.usage';

/** Shows the active provider and an estimate of today's tokens; click to change provider. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly disposables: vscode.Disposable[] = [this.item];

  constructor(private readonly state: vscode.Memento) {
    this.item.command = 'patchTutor.chooseProvider';
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('patchTutor.provider')) {
          this.update();
        }
      }),
    );
    this.update();
    this.item.show();
  }

  /** Called with each request's estimated tokens. */
  readonly recordUsage = (tokens: number): void => {
    const next = addUsage(this.state.get<DailyUsage>(USAGE_KEY), localDay(new Date()), tokens);
    void this.state.update(USAGE_KEY, next);
    this.update(next);
  };

  private update(usage = this.state.get<DailyUsage>(USAGE_KEY)): void {
    const provider = PROVIDERS.find((p) => p.id === getProviderId())?.label ?? getProviderId();
    const tokens = tokensToday(usage, localDay(new Date()));
    this.item.text = `$(mortar-board) ${provider} · ~${formatTokens(tokens)} tokens today`;
    this.item.tooltip =
      'Patch Tutor: active provider and an estimate of tokens used today (about 4 characters per token). Click to change provider.';
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }
}
