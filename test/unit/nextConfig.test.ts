import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextConfig = require('../../next.config.js') as {
  agentRules?: boolean;
  logging?: false | { serverFunctions?: boolean };
};

describe('next.config.js', () => {
  // regression: Next 16.3's `next dev` appends a "nextjs-agent-rules" block to
  // AGENTS.md when it detects an AI coding agent, unless `agentRules` is false,
  // so every workspace running the dev server got an uncommitted AGENTS.md.
  it('stops `next dev` from writing into AGENTS.md', () => {
    expect(nextConfig.agentRules).toBe(false);
  });

  // regression: once sign-in moved to a server action (WIS-38), `next dev`
  // logged each call with its arguments, printing the typed email to the
  // terminal. Only that log is off; the rest of Next's logging stays.
  it('stops `next dev` from logging server function arguments', () => {
    expect(nextConfig.logging).toEqual({ serverFunctions: false });
  });
});
