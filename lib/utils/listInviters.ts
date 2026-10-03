/**
 * Who invites people onto a list, as the "Want to reserve a gift?" note
 * (`JoinListCallout`) names them: each owner by their handle when there are
 * one or two and every one of them has a username, else "the owner" or "the
 * owners". `singular` says which form of the verb goes with it ("@anna_m
 * invites", "@anna_m and @chloe_r invite").
 *
 * The page only knows its owners' usernames, which are public, so no other
 * name (never an email) can end up here.
 */
export type ListInviters =
  | { handles: string[]; singular: boolean }
  | { generic: 'the owner' | 'the owners'; singular: boolean };

export function listInviters(ownerUsernames: readonly string[], ownerCount: number): ListInviters {
  const count = Math.max(ownerCount, ownerUsernames.length);
  if (count >= 1 && count <= 2 && ownerUsernames.length === count) {
    return { handles: ownerUsernames.map((username) => `@${username}`), singular: count === 1 };
  }
  return count === 1
    ? { generic: 'the owner', singular: true }
    : { generic: 'the owners', singular: false };
}
