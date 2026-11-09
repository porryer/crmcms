'use strict';
// 代码检查：npm run lint（CI 中临时安装 eslint，项目本身保持零依赖）
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/', 'data/', 'public/vendor/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      // 中文界面文案中有意使用全角空格
      'no-irregular-whitespace': ['error', { skipStrings: true, skipTemplates: true }],
      // 清洗输入时需要匹配控制字符
      'no-control-regex': 'off',
    },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    // page.evaluate 回调在浏览器中执行
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
