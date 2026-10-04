/**
 * Whether `username` is one of the handles we generate (`generateUniqueUsername`,
 * lib/utils/username.ts): `user_` plus 8 lowercase base36 characters. Kept apart
 * from that module, which reads the database, so the browser can ask too.
 */
export function isGeneratedUsername(username: string | null | undefined): boolean {
  return !!username && /^user_[a-z0-9]{8}$/.test(username);
}
