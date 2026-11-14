import tseslint from 'typescript-eslint';

const BROWSER = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'];

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  { rules: { 'no-eval': 'error', 'no-implied-eval': 'error', 'no-new-func': 'error' } },
  {
    files: ['src/{game,ui,content}/**', 'src/main.tsx'],
    languageOptions: { globals: Object.fromEntries(BROWSER.map((n) => [n, 'readonly'])) },
  },
  // ADR-001: engine/scenarios/codec pure — no DOM, clock, Math.random (SIM-02), no upward imports.
  {
    files: ['src/{engine,scenarios,codec}/**'],
    rules: {
      'no-restricted-globals': ['error', ...BROWSER, 'Date', 'performance', 'crypto', 'fetch'],
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'SIM-02: use seeded rng' }],
      'no-restricted-imports': ['error', { patterns: ['react', 'react-dom', '**/game/**', '**/ui/**', '**/content/**'] }],
    },
  },
];
