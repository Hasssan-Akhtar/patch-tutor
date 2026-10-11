/**
 * Whether `path` lies under `root`, both as URI paths ("/c:/repo/a.js").
 * Windows paths are case-insensitive, and VS Code and language servers do not
 * agree on drive letter case, so callers pass `ignoreCase` there.
 */
export function isInsidePath(path: string, root: string, ignoreCase: boolean): boolean {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return ignoreCase ? path.toLowerCase().startsWith(prefix.toLowerCase()) : path.startsWith(prefix);
}
