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
];

export default eslintConfig;
