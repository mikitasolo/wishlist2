// Runs the "must pass before done" checks in order and stops at the first
// failure, then prints what passed, what failed and what was skipped.
//   npm run verify              lint, format:check, tsc, test:cov, build, check:trace
//   npm run verify -- --quick   the pre-push subset: lint, format:check, tsc, test
import { spawnSync } from 'node:child_process';

const quick = process.argv.includes('--quick');
const common = [
  ['lint', ['npm', 'run', 'lint']],
  ['format:check', ['npm', 'run', 'format:check']],
  ['tsc', ['npx', 'tsc', '--noEmit']],
];
const steps = quick
  ? [...common, ['test', ['npm', 'test']]]
  : [
      ...common,
      ['test:cov', ['npm', 'run', 'test:cov']],
      ['build', ['npm', 'run', 'build']],
      ['check:trace', ['npm', 'run', 'check:trace']],
    ];

const results = [];
let failed = null;
for (const [name, [cmd, ...args]] of steps) {
  console.log(`\n==> ${name}`);
  const start = Date.now();
  const { status } = spawnSync(cmd, args, { stdio: 'inherit' });
  const secs = Math.round((Date.now() - start) / 1000);
  results.push({ name, ok: status === 0, secs });
  if (status !== 0) {
    failed = name;
    break;
  }
}

console.log(`\nverify${quick ? ' (quick)' : ''} summary`);
for (const { name, ok, secs } of results) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name} (${secs}s)`);
}
for (const [name] of steps.slice(results.length)) console.log(`  SKIP  ${name}`);
if (failed) {
  console.log(`\nStopped at ${failed}.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
