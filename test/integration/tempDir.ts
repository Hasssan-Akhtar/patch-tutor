import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * A new temp folder by its full path. On Windows the temp folder can be an
 * 8.3 short name (RUNNER~1) that language servers report in long form.
 */
export function makeTempDir(prefix: string): string {
  return realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
}

/**
 * Best-effort cleanup: on Windows, VS Code's Git extension can keep files in
 * a test repo open until the window closes, and the OS clears temp later.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (error) {
    if (process.platform !== 'win32') {
      throw error;
    }
  }
}
