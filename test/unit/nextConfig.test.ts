import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextConfig = require('../../next.config.js') as { agentRules?: boolean };

describe('next.config.js', () => {
  // regression: Next 16.3's `next dev` appends a "nextjs-agent-rules" block to
  // AGENTS.md when it detects an AI coding agent, unless `agentRules` is false,
  // so every workspace running the dev server got an uncommitted AGENTS.md.
  it('stops `next dev` from writing into AGENTS.md', () => {
    expect(nextConfig.agentRules).toBe(false);
  });
});
