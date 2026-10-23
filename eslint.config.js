// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'data/', '.agents/', '.claude/'] },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './tsconfig.server.json',
          './tsconfig.client.json',
          './tsconfig.node.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-only imports must say so, so they are erased and never pull a
      // server package into the browser bundle (or React into the server).
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
    },
  },

  // Node-side code: server, tests, tool configs.
  {
    files: ['src/server/**', 'test/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },

  // Browser bundle: React hooks rules, and no server-only imports.
  {
    files: ['src/client/**', 'src/features/**/*.client.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'express', message: 'Server-only: keep Express out of the browser bundle.' },
            { name: 'better-sqlite3', message: 'Server-only: keep SQLite out of the browser bundle.' },
          ],
          patterns: [
            { group: ['node:*'], message: 'Node built-ins do not exist in the browser.' },
            { group: ['**/server/**', '**/*.server', '**/*.server.js', '**/*.server.ts'], message: 'Client code must not import server modules.' },
          ],
        },
      ],
    },
  },
);
