import securityPlugin from 'eslint-plugin-security';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      '.aios-core/**',
      'supabase/**',
      'docs/**',
      '.agent/**',
      '.antigravity/**',
      '.claude/**',
      '.codex/**',
      '.cursor/**',
      '.gemini/**',
      '.github/**',
    ],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        project: false,
      },
    },
    plugins: {
      security: securityPlugin,
    },
    rules: {
      ...securityPlugin.configs.recommended.rules,
    },
  },
];
