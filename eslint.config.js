// ESLint 9 flat config.
//
// Two blocks: the React/TypeScript app under src/ and the plain-ESM Node
// side (server/, vite.config.ts, this file). Rules are tiered so the
// baseline passes without a cleanup sweep: anything that is a known
// hot-spot in this codebase (exhaustive-deps, explicit any) reports as a
// warning; anything that is a genuine defect (rules-of-hooks, unused vars,
// undefined names) is an error. Tighten tiers as the backlog is worked.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.vite/**',
      'public/**',
      'docs/**',
      'temp_data/**',
      'Claude outputs/**',
      '.agents/**',
      '.superpowers/**',
    ],
  },

  // ── App: React + TypeScript ────────────────────────────────────────────────
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks':   reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/rules-of-hooks':   'error',
      'react-hooks/exhaustive-deps':  'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      '@typescript-eslint/no-explicit-any':       'warn',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Untyped third-party modules (leaflet.markercluster, shpjs, plain-ESM
      // server code) need @ts-ignore; require a reason so each one is auditable.
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-ignore':       'allow-with-description',
        'ts-expect-error': 'allow-with-description',
        minimumDescriptionLength: 10,
      }],
    },
  },

  // ── Node side: Express server, Vite config, this file ─────────────────────
  {
    files: ['server/**/*.mjs', 'vite.config.ts', 'eslint.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      '@typescript-eslint/no-explicit-any':       'warn',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Untyped third-party modules (leaflet.markercluster, shpjs, plain-ESM
      // server code) need @ts-ignore; require a reason so each one is auditable.
      '@typescript-eslint/ban-ts-comment': ['error', {
        'ts-ignore':       'allow-with-description',
        'ts-expect-error': 'allow-with-description',
        minimumDescriptionLength: 10,
      }],
    },
  },

  {
    linterOptions: { reportUnusedDisableDirectives: 'warn' },
  },
)
