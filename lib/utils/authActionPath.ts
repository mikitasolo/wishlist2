// Mirrors Auth.js parseActionAndProviderId without logging untrusted paths.
// Keep in step with @auth/core when upgrading authentication.
const ACTIONS = new Set([
  'providers',
  'session',
  'csrf',
  'signin',
  'signout',
  'callback',
  'verify-request',
  'error',
  'webauthn-options',
]);
const PROVIDER_ACTIONS = new Set(['signin', 'callback', 'webauthn-options']);

export function isAuthActionPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/auth/')) return false;
  const parts = pathname.slice('/api/auth/'.length).split('/').filter(Boolean);
  const [action] = parts;
  return (
    (parts.length === 1 || parts.length === 2) &&
    ACTIONS.has(action) &&
    (parts.length === 1 || PROVIDER_ACTIONS.has(action))
  );
}
