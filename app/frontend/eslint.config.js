import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // Ignore generated / build output
  { ignores: ['dist/**', 'wailsjs/**', 'node_modules/**'] },

  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // ── React hooks ───────────────────────────────────────────────────────────
      ...reactHooks.configs.recommended.rules,

      // ── TypeScript ────────────────────────────────────────────────────────────
      // `any` is used intentionally in Wails bindings, xterm.js internals, and
      // plugin dispatch. Set to 'warn' so usages are visible but non-blocking.
      '@typescript-eslint/no-explicit-any': 'warn',
      // These type-checked rules fire heavily on the intentional `any` patterns
      // above. Kept as warnings so we can track and fix over time.
      '@typescript-eslint/no-unsafe-assignment':   'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument':     'warn',
      '@typescript-eslint/no-unsafe-return':       'warn',
      '@typescript-eslint/no-unsafe-call':         'warn',
      // Unnecessary type assertions — common where types are inferred correctly
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      // Promise-in-event-handler pattern is intentional in React JSX props
      '@typescript-eslint/no-misused-promises': 'warn',

      // Unused vars: allow underscore-prefixed names (common Go-convention carry-over)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // Floating promises: important for async event handlers
      '@typescript-eslint/no-floating-promises': 'error',

      // Consistent type assertions
      '@typescript-eslint/consistent-type-assertions': 'error',

      // Prefer optional chaining over && chains
      '@typescript-eslint/prefer-optional-chain': 'warn',

      // Nullish coalescing
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',

      // ── General JS/TS ────────────────────────────────────────────────────────
      // Disallow console.log in production code (use structured logging or remove)
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // Prefer const over let when variable is never reassigned
      'prefer-const': 'error',

      // Disallow var
      'no-var': 'error',

      // No duplicate imports
      'no-duplicate-imports': 'error',

      // Enforce === over ==
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
)
