/* eslint-env node */
module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2021: true
  },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    '@vue/eslint-config-typescript'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    // ── 代码风格 ──
    'indent': ['error', 2, { 'SwitchCase': 1 }],
    'quotes': ['error', 'single', { 'avoidEscape': true, 'allowTemplateLiterals': true }],
    'semi': ['error', 'never'],
    'comma-dangle': ['error', 'never'],
    'no-trailing-spaces': 'error',
    'eol-last': ['error', 'always'],

    // ── Vue 专项 ──
    'vue/multi-word-component-names': 'off',
    'vue/max-attributes-per-line': 'off',
    'vue/singleline-html-element-content-newline': 'off',
    'vue/html-self-closing': ['error', {
      'html': { 'void': 'always', 'normal': 'always', 'component': 'always' },
      'svg': 'always',
      'math': 'always'
    }],
    'vue/html-indent': ['error', 2],
    'vue/script-indent': ['error', 2, { 'baseIndent': 0, 'switchCase': 1 }],

    // ── TypeScript 专项 ──
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_' }],
    '@typescript-eslint/no-namespace': 'off',

    // ── 通用最佳实践 ──
    'no-console': ['warn', { 'allow': ['warn', 'error'] }],
    'no-debugger': 'warn',
    'no-unused-vars': 'off',
    'prefer-const': 'error',
    'no-var': 'error',
    'eqeqeq': ['error', 'always']
  },
  overrides: [
    // ── Electron 主进程文件 ──
    {
      files: ['electron/**/*.ts'],
      env: {
        node: true,
        browser: false
      },
      rules: {
        'no-console': 'off'
      }
    },
    // ── Vite/构建脚本文件 ──
    {
      files: ['vite.config.ts', 'scripts/**/*.js'],
      env: {
        node: true
      },
      rules: {
        'no-console': 'off'
      }
    }
  ]
}
