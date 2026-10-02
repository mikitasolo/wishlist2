import next from 'eslint-config-next';

// eslint-config-next v16 ships a native flat config (core-web-vitals + typescript).
const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'coverage/**', '.context/**', 'next-env.d.ts'] },
  ...next,
  {
    // The React Compiler is NOT enabled (no `reactCompiler` in next.config, no
    // babel plugin), so these two eslint-plugin-react-hooks rules are
    // compiler-*adoption* hints, not bug detectors. They false-positive on
    // legitimate patterns here (localStorage/hydration sync, fetch loading
    // flags, prop→state sync) and "fixing" preserve-manual-memoization by
    // deleting useMemo/useCallback would REGRESS perf without the compiler.
    // Turn them off until/unless we adopt the React Compiler. The classic hooks
    // rules (rules-of-hooks, exhaustive-deps) stay enabled at error.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    // Test files use plain <img> stubs on purpose (next/image is mocked).
    files: ['test/**'],
    rules: { '@next/next/no-img-element': 'off' },
  },
  {
    // E2E specs take `test` and `expect` from e2e/fixtures.ts, whose `test`
    // fails a spec on an uncaught page error or an unexpected console.error.
    // Types can still come from @playwright/test.
    files: ['e2e/**/*.ts'],
    ignores: ['e2e/fixtures.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@playwright/test',
              importNames: ['test', 'expect'],
              message:
                "Import test and expect from './fixtures', which fails a spec on console errors.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
