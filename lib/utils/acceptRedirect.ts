/**
 * Where the Invitations page lands when several accepts are in flight (WIS-121):
 * **the last accept clicked wins**, among those still able to succeed.
 *
 * Accepting an invite opens its list, but each card is answered on its own, so
 * a user can accept A and then B before A's answer is back. Redirecting on
 * every success took them to A's list and then, seconds later, pulled them over
 * to B's. Instead:
 *
 * - Only the most recently clicked accept that hasn't failed redirects. It does
 *   so as soon as it has succeeded, whatever earlier accepts are still pending.
 * - An accept that succeeds while a later one is still pending doesn't
 *   redirect yet. If every later one then fails (an error, a 404, the network),
 *   it is the last one left that could, so the page goes there once the last of
 *   them has failed.
 * - Once the page has redirected, nothing clicked before that redirects again:
 *   an earlier accept that succeeds afterwards only says so.
 *
 * Declines play no part: they never redirect, and don't stop an accept from
 * doing so. The caller toasts every outcome as before; this only decides the
 * redirect.
 */
export interface AcceptRedirect {
  /** An accept for `inviteId` was sent. */
  clicked(inviteId: string): void;
  /**
   * The accept for `inviteId` succeeded, opening `path`. Returns the path to
   * redirect to now, or null to stay put.
   */
  joined(inviteId: string, path: string): string | null;
  /**
   * The accept for `inviteId` didn't succeed, or its answer no longer counts.
   * Returns the path of an earlier accept that is now the last one left and
   * has already succeeded, or null.
   */
  failed(inviteId: string): string | null;
  /** Forgets every accept (another account signed in). */
  reset(): void;
}

export function createAcceptRedirect(): AcceptRedirect {
  // The accepts still in the running, in click order, each with the list it
  // opens once it has succeeded. A redirect empties it.
  let accepts: { inviteId: string; path: string | null }[] = [];

  function landing(): string | null {
    const last = accepts.at(-1);
    if (!last?.path) return null;
    accepts = [];
    return last.path;
  }

  return {
    clicked(inviteId) {
      accepts = [...accepts.filter((a) => a.inviteId !== inviteId), { inviteId, path: null }];
    },
    joined(inviteId, path) {
      const accept = accepts.find((a) => a.inviteId === inviteId);
      // Gone: a later accept already redirected.
      if (!accept) return null;
      accept.path = path;
      return landing();
    },
    failed(inviteId) {
      const before = accepts.length;
      accepts = accepts.filter((a) => a.inviteId !== inviteId);
      return accepts.length === before ? null : landing();
    },
    reset() {
      accepts = [];
    },
  };
}
