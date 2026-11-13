import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'node_modules/**', 'data/**', 'docs/**', 'projects/**', 'exports/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['error', { checkLoops: false }],
      'prefer-const': 'error',
    },
  },
  {
    // packages/core must stay pure: no DOM, no network, no Node APIs.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'fetch', 'localStorage', 'process'],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'fs', 'path', 'http', 'express', 'react*', 'three*'] }],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use a seeded RNG (core/geometry/rng).' }],
    },
  },
  { files: ['scripts/*.mjs'], languageOptions: { globals: { process: 'readonly', console: 'readonly' } } },
);
