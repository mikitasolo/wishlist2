/**
 * Share links the E2E setup seeds (WIS-335), on an Invite only list of the
 * friend's (`e2e-hidden`) that the E2E user isn't on.
 */

/** A live View link to `e2e-hidden`. */
export const E2E_VIEW_LINK_TOKEN = 'E2eViewLink0000000000a';

/**
 * A live Join link to `e2e-joinable`, an Invite only list of the E2E user's
 * that the friend isn't on (WIS-337): one spec has the friend join through it.
 */
export const E2E_JOIN_LINK_TOKEN = 'E2eJoinLink0000000000c';

/**
 * A revoked link's token: revoking deletes the link's row, so a token whose row
 * was deleted and one never stored are the same to every route.
 */
export const E2E_REVOKED_LINK_TOKEN = 'E2eRevokedLink0000000b';
