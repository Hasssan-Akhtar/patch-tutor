import * as vscode from 'vscode';
import { z } from 'zod';
import { parseUnifiedDiff } from '../git/diffParser';
import { ExplanationSchema } from '../llm/schemas';
import type { FollowUpService } from '../services/followUpService';
import { fixtureContext } from './promptEvals';

export const FollowUpFixtureSchema = z.object({
  /** A .diff file next to the fixture, with exactly one hunk. */
  diff: z.string().min(1),
  explanation: ExplanationSchema,
  message: z.string().min(1),
  /** Whether a good tutor corrects the explanation in reply to `message`. */
  expectRevised: z.boolean(),
});

/**
 * Development-only: sends each follow-up fixture to the configured provider
 * and reports whether the tutor revised the explanation when it should, and
 * held its ground when it should not.
 */
export async function runFollowUpEvals(
  extensionUri: vscode.Uri,
  service: FollowUpService,
  modelKey: string,
): Promise<void> {
  const dir = vscode.Uri.joinPath(extensionUri, 'test', 'fixtures', 'followups');
  const read = async (name: string) =>
    new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, name)));
  const names = (await vscode.workspace.fs.readDirectory(dir))
    .map(([name]) => name)
    .filter((name) => name.endsWith('.json'))
    .sort();

  const report = [
    '# Follow-up prompt eval',
    '',
    `- Model: \`${modelKey}\``,
    `- Run at: ${new Date().toISOString()}`,
  ];
  let passed = 0;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Follow-up evals', cancellable: true },
    async (progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      for (const name of names) {
        if (controller.signal.aborted) {
          return;
        }
        progress.report({ message: name });
        const fixture = FollowUpFixtureSchema.parse(JSON.parse(await read(name)));
        const [hunk] = parseUnifiedDiff(await read(fixture.diff));
        if (!hunk) {
          report.push('', `## ${name}`, '', '_No hunk in the diff._');
          continue;
        }
        const result = await service.ask({
          hunk,
          repoRoot: undefined,
          depth: fixture.explanation.depth,
          explanation: fixture.explanation,
          history: [],
          question: fixture.message,
          context: await fixtureContext(hunk),
          signal: controller.signal,
        });
        const ok = !!result.revised === fixture.expectRevised;
        passed += ok ? 1 : 0;
        const got = `${result.revised ? 'yes' : 'no'}${result.structured ? '' : ' (reply was not valid JSON)'}`;
        report.push(
          '',
          `## ${ok ? '✅' : '❌'} ${name}`,
          '',
          `**Message:** ${fixture.message}`,
          '',
          `**Expected revision:** ${fixture.expectRevised ? 'yes' : 'no'} · **Got:** ${got}`,
          '',
          `**Answer:** ${result.answer}`,
          ...(result.revised
            ? [
                '',
                `**Mistake named:** ${result.mistake}`,
                '',
                `**Revised why it works:** ${result.revised.whyItWorks}`,
              ]
            : []),
        );
      }
    },
  );

  report.splice(4, 0, `- Passed: ${passed}/${names.length}`);
  const outDir = vscode.Uri.joinPath(extensionUri, 'evals', 'output');
  await vscode.workspace.fs.createDirectory(outDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = vscode.Uri.joinPath(outDir, `follow-up-${stamp}.md`);
  await vscode.workspace.fs.writeFile(outFile, new TextEncoder().encode(report.join('\n') + '\n'));
  await vscode.window.showTextDocument(outFile, { preview: false });
}
