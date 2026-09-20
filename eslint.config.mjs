import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { withVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'

export default withVueTs(
  // 全局忽略（替代 .eslintignore）
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'data/**',
      '.vscode/**',
      '.idea/**',
      '.cursor/**',
      '.trae/**',
      '.augment/**',
      '.codebuddy/**',
      'resources/aria2c.exe',
      '**/*.json',
      '**/*.bat',
      '**/*.ico',
      '**/*.png',
      '**/*.conf',
      '**/*.css',
      'LICENSE',
      'index.html',
      'eslint_output.txt',
      'src/types/*.d.ts',
      'src/i18n/types.d.ts',
      'scripts/**'
    ]
  },

  // 基础 JS 推荐规则
  js.configs.recommended,

  // Vue 3 essential 规则
  pluginVue.configs['flat/essential'],

  // TypeScript recommended 规则
  vueTsConfigs.recommended,

  // 全局规则
  {
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
      '@typescript-eslint/no-unused-vars': ['warn', { 'argsIgnorePattern': '^_', 'caughtErrorsIgnorePattern': '^_' }],
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unsafe-function-type': 'off',
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',

      // ── 通用最佳实践 ──
      'no-console': ['warn', { 'allow': ['warn', 'error'] }],
      'no-debugger': 'warn',
      'no-unused-vars': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always']
    }
  },

  // ── Electron 主进程文件 ──
  {
    files: ['electron/**/*.ts'],
    rules: {
      'no-console': 'off'
    }
  },

  // ── 浏览器扩展与插件（MV3 Service Worker / 沙箱脚本：浏览器 + chrome 全局变量） ──
  {
    files: ['extension/**/*.js', 'plugins/**/*.js'],
    languageOptions: {
      globals: {
        chrome: 'readonly',
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        DOMException: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        FormData: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        // 插件沙箱注入的 API（plugins/**，由 PluginManager 提供）
        module: 'writable',
        exports: 'writable',
        aria2: 'readonly',
        settings: 'readonly',
        notify: 'readonly'
      }
    },
    rules: {
      'no-console': 'off'
    }
  },

  // ── Vite 配置文件 ──
  {
    files: ['vite.config.mts'],
    rules: {
      'no-console': 'off'
    }
  }
)
