/**
 * Blob settings for the app server the E2E harness starts (WIS-221).
 *
 * `@vercel/blob` prefers `VERCEL_OIDC_TOKEN` + `BLOB_STORE_ID` over
 * `BLOB_READ_WRITE_TOKEN`, and a `.env` pulled from Vercel carries them, so a
 * dummy token alone still left an unrouted upload writing to the real store.
 * Blank both (an empty value counts as set, so Next doesn't fill it in from a
 * file), use a dummy token, and point the SDK's API at a closed local port so
 * that anything that does reach it fails instead of writing anywhere.
 */
export const E2E_BLOB_ENV = {
  VERCEL_OIDC_TOKEN: '',
  BLOB_STORE_ID: '',
  BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_e2edummystore_dummysecret',
  VERCEL_BLOB_API_URL: 'http://127.0.0.1:9',
} as const;
