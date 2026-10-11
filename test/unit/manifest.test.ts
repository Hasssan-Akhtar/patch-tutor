import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface WalkthroughStep {
  id: string;
  description: string;
  media: { markdown?: string; image?: string };
  completionEvents?: string[];
}

interface Manifest {
  contributes: {
    commands: { command: string }[];
    views: Record<string, { id: string }[]>;
    walkthroughs: { steps: WalkthroughStep[] }[];
  };
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as Manifest;
const steps = manifest.contributes.walkthroughs.flatMap((w) => w.steps);

// VS Code adds a `<view id>.focus` command for every contributed view.
const commands = new Set([
  ...manifest.contributes.commands.map((c) => c.command),
  ...Object.values(manifest.contributes.views)
    .flat()
    .map((v) => `${v.id}.focus`),
]);
const views = new Set(
  Object.values(manifest.contributes.views)
    .flat()
    .map((v) => v.id),
);

describe('walkthrough', () => {
  it.each(steps.map((s) => [s.id, s] as const))('step %s has its media file', (_id, step) => {
    const file = step.media.markdown ?? step.media.image;
    expect(file).toBeDefined();
    expect(existsSync(file as string)).toBe(true);
  });

  it.each(steps.map((s) => [s.id, s] as const))(
    'step %s links and listens only to real commands and views',
    (_id, step) => {
      const linked = [...step.description.matchAll(/\(command:([\w.]+)\)/g)].map((m) => m[1]);
      for (const command of linked) {
        expect(commands).toContain(command);
      }
      for (const event of step.completionEvents ?? []) {
        const [kind, target] = event.split(':');
        expect(kind === 'onCommand' ? commands : views).toContain(target);
      }
    },
  );
});
