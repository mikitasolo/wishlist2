/**
 * MongoDB's duplicate-key error: a unique index refusing a write. Its message
 * and `keyValue` quote the clashing value (often an email), so never log one
 * whole; `duplicateKeyField` says which index it was without the value.
 */
export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000;
}

/** The field whose unique index a duplicate-key error tripped (`email`, `username`), or null for any other error. */
export function duplicateKeyField(err: unknown): string | null {
  if (!isDuplicateKeyError(err)) return null;
  const pattern = (err as { keyPattern?: unknown }).keyPattern;
  const field =
    typeof pattern === 'object' && pattern !== null ? Object.keys(pattern)[0] : undefined;
  return field ?? 'key';
}
