import tsPlugin from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'

export default [
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['src/**/*.{ts,js}'],
    ignores: ['node_modules', 'www'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin
    },
    rules: {
      semi: ['error', 'never'],
      quotes: ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
      'max-len': [
        'error',
        { code: 120, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true, ignoreRegExpLiterals: true }
      ],
      'object-curly-spacing': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      'arrow-parens': ['error', 'always'],
      '@typescript-eslint/no-explicit-any': ['warn', { ignoreRestArgs: true }],
      'lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: true }],
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'multiline-block-like', next: '*' },
        { blankLine: 'never', prev: '*', next: 'return' }
      ]
    }
  }
]
