import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('../../app', import.meta.url));

/**
 * The URL path of every App Router route handler under `dir`, e.g.
 * `app/api/(group)/foo/[id]/route.ts` → `/api/foo/[id]`. Route groups don't
 * add a segment, and `_private` folders are opted out of routing.
 */
function routeHandlerPaths(dir: string): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('_')) paths.push(...routeHandlerPaths(join(dir, entry.name)));
    } else if (/^route\.[cm]?[jt]sx?$/.test(entry.name)) {
      const segments = relative(APP_DIR, dir)
        .split(sep)
        .filter((s) => s && !/^\(.*\)$/.test(s));
      paths.push('/' + segments.join('/'));
    }
  }
  return paths;
}

describe('removed API routes', () => {
  const paths = routeHandlerPaths(APP_DIR);

  it('finds the route handlers that do exist', () => {
    // Guards the check below against passing vacuously if the walk breaks.
    expect(paths).toContain('/api/invites/[inviteId]');
    expect(paths).toContain('/api/wishlists/[id]/members');
  });

  // regression: app/api/invite/route.ts, left over from the admin panel deleted
  // in 2269f4d, only checked "is signed in": GET listed every user with their
  // email, PATCH { isArchived: true } deleted any user's sessions, and POST
  // created a User for an arbitrary address and emailed it the inviter's
  // address. Invites are registered-users-only, by username, through
  // POST /api/wishlists/[id]/members. Nothing may serve /api/invite again.
  it('regression: nothing serves the legacy /api/invite endpoint', () => {
    expect(paths).not.toContain('/api/invite');
  });
});
