'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';
import { withWelcomeMarker } from '@/lib/utils/memberWelcome';

export interface LinkJoinControl {
  /** A join is in flight. */
  busy: boolean;
  /**
   * Join the list through the share link. Resolves once answered: on success
   * the page has been sent on to the list (with the welcome note for a new
   * member); on failure a toast said why. Never rejects.
   */
  join: () => Promise<void>;
}

/** What a refused join says. A dead link reads as one, whatever the reason. */
export const LINK_JOIN_DEAD_TEXT =
  'This link doesn’t work anymore. Ask the person who sent it for a new one.';

/**
 * Joining a list straight from a Join share link (WIS-337):
 * `POST /api/wishlists/[id]/join` with the link in `X-Share-Token`. Only ever
 * called from the confirmation's Join button: nothing joins on page load. A
 * new member lands on the list's own URL with `?welcome=1` (`MemberWelcome`);
 * someone who turns out to be on it already lands there plainly.
 */
export function useLinkJoin(listId: string | null, linkToken: string | null): LinkJoinControl {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  // Blocks a second join synchronously, before `busy` renders.
  const inFlight = useRef(false);

  const join = useCallback(async () => {
    if (!listId || !linkToken || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/wishlists/${listId}/join`, {
        method: 'POST',
        headers: { [SHARE_TOKEN_HEADER]: linkToken },
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        const { wishlistSlug, wishlistId, alreadyMember } = result.data ?? {};
        const path = `/wishlists/${wishlistSlug || wishlistId || listId}`;
        router.push(alreadyMember ? path : withWelcomeMarker(path));
        return;
      }
      showToast(
        res.status === 404 ? LINK_JOIN_DEAD_TEXT : result.error || 'Couldn’t join the list',
        'error'
      );
    } catch {
      showToast('Couldn’t join the list', 'error');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [listId, linkToken, router, showToast]);

  return { busy, join };
}
