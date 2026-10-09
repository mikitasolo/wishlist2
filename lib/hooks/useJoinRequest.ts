'use client';

import { track } from '@/lib/analytics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { SHARE_TOKEN_HEADER } from '@/lib/utils/shareLinkFields';

/**
 * Where a visitor stands with asking a list's owners to invite them:
 * `unknown` until their read lands (and if it fails: a failed read is never
 * shown as "not asked"), then `none` or `requested`.
 */
export type JoinRequestState = 'unknown' | 'none' | 'requested';

export interface JoinRequestControl {
  state: JoinRequestState;
  /** An ask or a cancel is in flight. */
  busy: boolean;
  ask: () => void;
  cancel: () => void;
}

/**
 * A signed-in visitor's request to join the list `listId` (WIS-275): reads
 * whether they've asked (`GET /api/wishlists/[id]/requests/me`), and offers
 * Ask to join (`POST /requests`) and Cancel request (`DELETE /requests/me`).
 * Only reads while `enabled` (a signed-in viewer who is neither an owner nor a
 * member), and keyed on the viewer and the list, so another account or list
 * never shows the previous one's state. A decline is never told apart: the
 * server answers "requested" for it until they may ask again.
 *
 * On a share link's page (`linkToken`, WIS-335) every request carries the
 * token in `X-Share-Token`, which is what lets a visitor the list's
 * visibility wouldn't admit ask at all.
 */
export function useJoinRequest(
  listId: string | null,
  viewerId: string | null,
  enabled: boolean,
  linkToken: string | null = null
): JoinRequestControl {
  const { showToast } = useToast();
  const [read, setRead] = useState<{ key: string; state: JoinRequestState } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = enabled && listId && viewerId ? `${viewerId}:${listId}` : null;
  // The key now, for an answer that lands after the viewer or list changed.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  useEffect(() => {
    if (!key || !listId) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch(`/api/wishlists/${listId}/requests/me`, {
          cache: 'no-store',
          headers: linkHeaders(linkToken),
        });
        const result = await res.json();
        if (!live || !result.success) return;
        setRead({ key, state: result.data?.requested ? 'requested' : 'none' });
      } catch {
        /* stays unknown: no button rather than a wrong one */
      }
    })();
    return () => {
      live = false;
    };
  }, [key, listId, linkToken]);

  const state: JoinRequestState = key && read?.key === key ? read.state : 'unknown';

  const send = useCallback(
    async (method: 'POST' | 'DELETE') => {
      const sentFor = keyRef.current;
      if (!sentFor || !listId || busy) return;
      setBusy(true);
      try {
        const url =
          method === 'POST'
            ? `/api/wishlists/${listId}/requests`
            : `/api/wishlists/${listId}/requests/me`;
        const res = await fetch(url, { method, headers: linkHeaders(linkToken) });
        const result = await res.json().catch(() => ({}));
        if (keyRef.current !== sentFor) return;
        if (result.success) {
          const next: JoinRequestState = result.data?.requested ? 'requested' : 'none';
          setRead({ key: sentFor, state: next });
          if (method === 'POST' && next === 'requested') track('join_requested');
          showToast(
            next === 'requested' ? 'Request sent to the owners' : 'Request cancelled',
            'success'
          );
        } else {
          showToast(
            result.error ||
              (method === 'POST' ? 'Couldn’t send your request' : 'Couldn’t cancel your request'),
            'error'
          );
        }
      } catch {
        showToast(
          method === 'POST' ? 'Couldn’t send your request' : 'Couldn’t cancel your request',
          'error'
        );
      } finally {
        setBusy(false);
      }
    },
    [listId, busy, showToast, linkToken]
  );

  const ask = useCallback(() => void send('POST'), [send]);
  const cancel = useCallback(() => void send('DELETE'), [send]);
  return { state, busy, ask, cancel };
}

/** A share link's header, when there's a link. */
function linkHeaders(linkToken: string | null): HeadersInit | undefined {
  return linkToken ? { [SHARE_TOKEN_HEADER]: linkToken } : undefined;
}
