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

  // Server halves of features: no React, no client modules.
  {
    files: ['src/features/**/*.server.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'Client-only: keep React out of the server bundle.' },
            { name: 'react-dom', message: 'Client-only: keep React out of the server bundle.' },
          ],
          patterns: [
            { group: ['react/*', 'react-dom/*'], message: 'Client-only: keep React out of the server bundle.' },
            { group: ['**/client/**', '**/*.client', '**/*.client.js', '**/*.client.ts', '**/*.client.tsx'], message: 'Server code must not import client modules.' },
          ],
        },
      ],
    },
  },

  // The feature contract is imported by both bundles, so it holds types only.
  // A value import here would drag Express into the browser or React into the
  // server. consistent-type-imports alone misses an import used as a value.
  {
    files: ['src/features/types.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[importKind!='type']",
          message: 'src/features/types.ts is type-only: use `import type { ... }`.',
        },
        {
          selector: "ExportAllDeclaration[exportKind!='type'], ExportNamedDeclaration[source][exportKind!='type']",
          message: 'src/features/types.ts is type-only: use `export type { ... } from`.',
        },
        {
          selector: ':matches(Program, ExportNamedDeclaration) > :matches(VariableDeclaration, FunctionDeclaration, ClassDeclaration, TSEnumDeclaration, TSModuleDeclaration)',
          message: 'src/features/types.ts holds type declarations only.',
        },
        {
          selector: 'ExportDefaultDeclaration',
          message: 'src/features/types.ts holds type declarations only.',
        },
      ],
    },
  },
);
