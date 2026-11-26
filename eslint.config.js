import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/.vite/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver-next': [
        importX.createNodeResolver({
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'],
        }),
      ],
    },
    rules: {
      'import-x/no-cycle': ['error', { maxDepth: 5 }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
