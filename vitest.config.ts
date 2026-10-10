import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';

// Mirrors esbuild's `.md: 'text'` loader so prompt imports work in tests.
const markdownAsText: Plugin = {
  name: 'markdown-as-text',
  load(id) {
    return id.endsWith('.md')
      ? `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`
      : null;
  },
};

export default defineConfig({
  plugins: [markdownAsText],
  resolve: {
    alias: { vscode: fileURLToPath(new URL('./test/unit/mocks/vscode.ts', import.meta.url)) },
  },
  test: {
    include: ['test/unit/**/*.test.ts'],
  },
});
