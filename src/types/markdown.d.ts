// Prompt templates are imported as plain strings (esbuild and Vitest both load .md as text).
declare module '*.md' {
  const content: string;
  export default content;
}
