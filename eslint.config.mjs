import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/', 'out/', '.vscode-test/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly' },
    },
  },
);
