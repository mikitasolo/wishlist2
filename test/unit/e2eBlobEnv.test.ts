import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { put } from '@vercel/blob';
import { E2E_BLOB_ENV } from '../../e2e/blobEnv';

// regression: WIS-221. A workspace .env pulled from Vercel carries
// VERCEL_OIDC_TOKEN + BLOB_STORE_ID, which @vercel/blob prefers over
// BLOB_READ_WRITE_TOKEN, so the E2E app server (next start, which loads .env)
// wrote to the real store even with a dummy token.
describe('the E2E harness keeps the app off the real Blob store', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('blanks the OIDC credentials and uses a dummy token', () => {
    expect(E2E_BLOB_ENV.VERCEL_OIDC_TOKEN).toBe('');
    expect(E2E_BLOB_ENV.BLOB_STORE_ID).toBe('');
    expect(E2E_BLOB_ENV.BLOB_READ_WRITE_TOKEN).toMatch(/^vercel_blob_rw_e2edummystore_/);
  });

  it('makes an unrouted upload fail without leaving the machine, whatever .env held', async () => {
    // What the copied .env would have put in the server's environment...
    vi.stubEnv('VERCEL_OIDC_TOKEN', 'real-oidc-token');
    vi.stubEnv('BLOB_STORE_ID', 'store_real');
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'vercel_blob_rw_realstore_secret');
    // ...overridden by the harness.
    for (const [k, v] of Object.entries(E2E_BLOB_ENV)) vi.stubEnv(k, v);

    // The SDK talks through undici, so stand in for the API with a local
    // server that refuses everything, and read what the SDK sent it.
    const seen: { auth: string | undefined }[] = [];
    const server = createServer((req, res) => {
      seen.push({ auth: req.headers.authorization });
      res.statusCode = 403;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: { code: 'forbidden', message: 'no' } }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      vi.stubEnv(
        'VERCEL_BLOB_API_URL',
        `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      );
      await expect(put('uploads/x/test.txt', 'x', { access: 'public' })).rejects.toThrow();
    } finally {
      server.close();
    }
    expect(seen.length).toBeGreaterThan(0);
    // It used the dummy token, never the OIDC one or the real store's.
    for (const { auth } of seen) expect(auth).toBe(`Bearer ${E2E_BLOB_ENV.BLOB_READ_WRITE_TOKEN}`);
    // And the harness's own API address is one nothing listens on.
    expect(E2E_BLOB_ENV.VERCEL_BLOB_API_URL).toBe('http://127.0.0.1:9');
  });

  it('is applied to the server the harness starts', async () => {
    const { readFile } = await import('fs/promises');
    const src = await readFile(new URL('../../e2e/global-setup.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/\.\.\.E2E_BLOB_ENV/);
  });
});
