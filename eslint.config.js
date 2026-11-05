const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['app/vendor/**', 'dist/**', 'app/sample-lecture.js', '_site/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  {
    files: ['app/**/*.js', 'site/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    files: ['app/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['scripts/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // page.evaluate() callbacks run in the browser
    files: ['tests/**/*.js', 'scripts/screenshots.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
];
