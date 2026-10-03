import { getVisibility, type Visibility } from './visibility';

/**
 * Who, besides the owners, a list's link opens for. It's `getWishlistViewAccess`
 * read for the owner, so the Share popover can tell them before they send it:
 * - `anyone`: a Public list, signed in or not;
 * - `friends-and-members`: a Friends list, for anyone who's friends (mutual
 *   follows) with any of its owners, and its members;
 * - `members`: an Invite only list, for its members;
 * - `owners`: an archived list, whatever its visibility: everyone else gets
 *   the answer a missing list gets.
 *
 * `test/api/shareLinkAudience.test.ts` pins it to `getWishlistViewAccess`, so
 * change them together. It only informs the owner and decides no access.
 */
export type LinkAudience = 'anyone' | 'friends-and-members' | 'members' | 'owners';

export function linkAudience(w: {
  visibility?: Visibility | null;
  archived?: boolean | null;
}): LinkAudience {
  if (w.archived) return 'owners';
  const visibility = getVisibility(w);
  if (visibility === 'everyone') return 'anyone';
  if (visibility === 'friends') return 'friends-and-members';
  return 'members';
}

/** What the Share popover tells a list's owners about its link. */
export const LINK_AUDIENCE_TEXT: Record<LinkAudience, string> = {
  anyone: 'Anyone with the link can view.',
  'friends-and-members': 'Only friends of the owners, and people on the list, can open it.',
  members: 'Only people on the list can open it.',
  owners: "Archived: the link won't open for anyone but the owners.",
};

/**
 * Whether Share should open the phone's share sheet: there's a Web Share API
 * and the main pointer is a finger. A desktop browser may have
 * `navigator.share` too, but there copying the link is what people expect.
 * Read in the browser only (a click, or `useSyncExternalStore`'s client
 * snapshot), never in a render the server also does.
 */
export function canUseShareSheet(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (typeof navigator.share !== 'function') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/** `url` (a path or a full URL) made absolute against the page, or the page's own URL. */
export function resolveShareUrl(url?: string): string {
  return new URL(url ?? window.location.href, window.location.href).href;
}

/**
 * - `shared`: the share sheet took the link;
 * - `cancelled`: the person closed the sheet, so nothing more is said;
 * - `copied`: the link is on the clipboard;
 * - `failed`: it couldn't be copied;
 * - `unshared`: the sheet failed and copying it instead failed too.
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'failed' | 'unshared';

const isAbort = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  (error as { name?: unknown }).name === 'AbortError';

/**
 * Hands the link to the share sheet when `sheet` is set, else (or when the
 * sheet fails for any reason but a cancel) copies it. Call it straight from a
 * click: the share sheet needs the click's user activation.
 */
export async function shareOrCopy(
  { url, title }: { url: string; title?: string },
  { sheet }: { sheet: boolean }
): Promise<ShareOutcome> {
  let sheetFailed = false;
  if (sheet && typeof navigator.share === 'function') {
    try {
      await navigator.share(title ? { url, title } : { url });
      return 'shared';
    } catch (error) {
      if (isAbort(error)) return 'cancelled';
      // Anything else (no permission, a sheet that can't open): copy instead.
      // The sheet has used up the click's user activation by now, which
      // Safari's clipboard needs, so this copy may well be refused there.
      sheetFailed = true;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return 'copied';
  } catch {
    return sheetFailed ? 'unshared' : 'failed';
  }
}
