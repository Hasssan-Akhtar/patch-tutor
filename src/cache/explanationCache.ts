import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { ExplanationSchema, type Depth, type Explanation } from '../llm/schemas';

export interface CacheKeyParts {
  hunkId: string;
  depth: Depth;
  /** Provider and model, e.g. "vscodeLm:gpt-4o". */
  model: string;
  /** Changes whenever the prompt text changes, so stale explanations are not reused. */
  promptVersion: string;
}

export function cacheKey(parts: CacheKeyParts): string {
  return createHash('sha1')
    .update([parts.hunkId, parts.depth, parts.model, parts.promptVersion].join('\0'))
    .digest('hex');
}

const FileSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), z.object({ savedAt: z.number(), value: ExplanationSchema })),
});
type CacheFile = z.infer<typeof FileSchema>;

/** Explanations persisted to one JSON file, evicting the oldest past `maxEntries`. */
export class ExplanationCache {
  private data: CacheFile | undefined;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string): Promise<Explanation | undefined> {
    return (await this.load()).entries[key]?.value;
  }

  async set(key: string, value: Explanation): Promise<void> {
    const data = await this.load();
    data.entries[key] = { savedAt: this.now(), value };
    this.evict(data);
    await this.save(data);
  }

  async clear(): Promise<void> {
    await this.save({ version: 1, entries: {} });
  }

  private evict(data: CacheFile): void {
    const entries = Object.entries(data.entries);
    if (entries.length <= this.maxEntries) {
      return;
    }
    const newest = entries.sort(([, a], [, b]) => b.savedAt - a.savedAt).slice(0, this.maxEntries);
    data.entries = Object.fromEntries(newest);
  }

  private async load(): Promise<CacheFile> {
    if (!this.data) {
      try {
        this.data = FileSchema.parse(JSON.parse(await readFile(this.filePath, 'utf8')));
      } catch {
        // Missing or corrupt cache: start empty; it is only a cache.
        this.data = { version: 1, entries: {} };
      }
    }
    return this.data;
  }

  private save(data: CacheFile): Promise<void> {
    this.data = data;
    // Serialize writes, and write to a temp file first so a crash cannot leave half a file.
    this.writing = this.writing.then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(data));
      await rename(tmp, this.filePath);
    });
    return this.writing;
  }
}
