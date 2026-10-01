/**
 * What to log about a failure whose message may quote its input (an email
 * address, a session token, a query's values): its kind, as the error's own
 * `name` plus the given code-like `fields`, never the message.
 */
export function errorKind(
  err: unknown,
  fields: readonly string[] = ['name', 'code']
): Record<string, unknown> {
  if (typeof err !== 'object' || err === null) return { name: typeof err };
  const e = err as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, e[field]]));
}
