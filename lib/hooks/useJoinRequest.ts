'use client';

import { track } from '@/lib/analytics';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import { useUndoableAction } from '@/lib/hooks/useUndoableAction';
import type { PendingCommit } from '@/lib/utils/deferredCommit';
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
 *
 * Cancel request waits out an Undo window before it's sent (WIS-387): asking
 * again would tell the owners again, so Undo, or Ask to join meanwhile, keeps
 * the request with nothing sent.
 */
export function useJoinRequest(
  listId: string | null,
  viewerId: string | null,
  enabled: boolean,
  linkToken: string | null = null
): JoinRequestControl {
  const { showToast } = useToast();
  const offerUndo = useUndoableAction();
  // A cancel waiting out its Undo window, if any.
  const pendingCancel = useRef<PendingCommit | null>(null);
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
    async (method: 'POST' | 'DELETE', keepalive = false, sentFor = keyRef.current) => {
      if (!sentFor || !listId || (busy && method === 'POST')) return;
      setBusy(true);
      try {
        const url =
          method === 'POST'
            ? `/api/wishlists/${listId}/requests`
            : `/api/wishlists/${listId}/requests/me`;
        const res = await fetch(url, {
          method,
          headers: linkHeaders(linkToken),
          ...(keepalive ? { keepalive } : {}),
        });
        const result = await res.json().catch(() => ({}));
        if (keyRef.current !== sentFor) return;
        if (result.success) {
          const next: JoinRequestState = result.data?.requested ? 'requested' : 'none';
          setRead({ key: sentFor, state: next });
          if (method === 'POST' && next === 'requested') track('join_requested');
          // A cancel's Undo toast has said it already.
          if (method === 'POST') {
            showToast(
              next === 'requested' ? 'Request sent to the owners' : 'Request cancelled',
              'success'
            );
          }
        } else {
          // A cancel that didn't go through: the request stands.
          if (method === 'DELETE') setRead({ key: sentFor, state: 'requested' });
          showToast(
            result.error ||
              (method === 'POST' ? 'Couldn’t send your request' : 'Couldn’t cancel your request'),
            'error'
          );
        }
      } catch {
        if (method === 'DELETE' && keyRef.current === sentFor) {
          setRead({ key: sentFor, state: 'requested' });
        }
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

  const ask = useCallback(() => {
    // Asked again while the cancel still waits: that's its Undo.
    if (pendingCancel.current?.undo()) return;
    void send('POST');
  }, [send]);

  const cancel = useCallback(() => {
    const sentFor = keyRef.current;
    if (!sentFor || !listId || busy || pendingCancel.current?.isPending()) return;
    setRead({ key: sentFor, state: 'none' });
    const pending = offerUndo({
      message: 'Request cancelled',
      commit: ({ keepalive }) => send('DELETE', keepalive, sentFor),
      onUndo: () => {
        if (keyRef.current === sentFor) setRead({ key: sentFor, state: 'requested' });
      },
    });
    pendingCancel.current = pending;
    void pending.settled.then(() => {
      if (pendingCancel.current === pending) pendingCancel.current = null;
    });
  }, [listId, busy, offerUndo, send]);
  return { state, busy, ask, cancel };
}

/** A share link's header, when there's a link. */
function linkHeaders(linkToken: string | null): HeadersInit | undefined {
  return linkToken ? { [SHARE_TOKEN_HEADER]: linkToken } : undefined;
}
