import js from '@eslint/js';
import globals from 'globals';
import pluginReact from 'eslint-plugin-react';

export default [
  {
    ignores: ['**/.next/**', '**/node_modules/**'],
  },
  js.configs.recommended,
  pluginReact.configs.flat.recommended,
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['next.config.js', '**/*.config.{js,cjs}', 'src/shims/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
];
