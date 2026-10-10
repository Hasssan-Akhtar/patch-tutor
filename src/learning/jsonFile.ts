import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';

/** Reads and validates a JSON file; returns undefined when it is missing or invalid. */
export async function readJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    return schema.parse(JSON.parse(await readFile(filePath, 'utf8')));
  } catch {
    return undefined;
  }
}

/** Writes via a temp file and rename, so a crash cannot leave half a file. */
export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, filePath);
}
