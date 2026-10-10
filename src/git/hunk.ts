export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface Hunk {
  /** sha1 of the file path and the hunk's changed lines; stable when the hunk moves. */
  id: string;
  /** Repo-relative path. For deleted files this is the old path. */
  filePath: string;
  /** Set only when the file was renamed. */
  oldPath?: string;
  status: FileStatus;
  newStart: number;
  newLines: number;
  oldStart: number;
  oldLines: number;
  added: string[];
  removed: string[];
  /** The hunk as it appears in the unified diff, starting with its @@ header. */
  raw: string;
}
