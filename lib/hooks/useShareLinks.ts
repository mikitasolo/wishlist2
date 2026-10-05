'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';
import type { ShareLinkLevel } from '@/lib/utils/shareLinkFields';
import { isLinkExpired } from '@/lib/utils/shareLinkExpiry';

/** A share link as the owners' link list answers it (`serializeShareLink`), dates as strings. */
export interface ShareLinkRow {
  _id: string;
  level: ShareLinkLevel;
  label: string | null;
  expiresAt: string | null;
  createdAt: string;
  state: 'live' | 'expired';
  joinedCount: number;
  /** Only from the link list and a create's answer: an edit's answer has none. */
  token?: string;
}

/** What New link sends. */
export interface NewShareLink {
  level: ShareLinkLevel;
  label: string | null;
  expiresAt: string | null;
}

/** What an edit sends: only the fields the owner changed. */
export type ShareLinkPatch = Partial<Pick<NewShareLink, 'label' | 'expiresAt'>>;

/** The path a link opens the list at. */
export function shareLinkUrl(token: string): string {
  return `/l/${token}`;
}

/** Whether a row still works at `now`: the server said live, and it hasn't run out since. */
export function isLinkLive(link: Pick<ShareLinkRow, 'state' | 'expiresAt'>, now: Date): boolean {
  return link.state === 'live' && !isLinkExpired(link, now);
}

export interface ShareLinksControl {
  /** Where the first read stands. A failed later read keeps the rows it has. */
  read: 'loading' | 'failed' | 'loaded';
  links: ShareLinkRow[];
  /** How many still work, for "Also anyone with one of your N share links." */
  liveCount: number;
  retry: () => void;
  create: (input: NewShareLink) => Promise<ShareLinkRow | null>;
  update: (id: string, patch: ShareLinkPatch) => Promise<boolean>;
  revoke: (id: string) => Promise<boolean>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * A list's share links, for its owners (WIS-335): read from
 * `GET /api/wishlists/[id]/links` while `enabled`, and created, edited and
 * revoked through the owners' link routes. `listId` is the list's `_id`. A
 * failed first read is `failed` (the section shows `LoadError`), never an
 * empty list; a later failed read keeps what's shown.
 */
export function useShareLinks(listId: string | null, enabled: boolean): ShareLinksControl {
  const { showToast } = useToast();
  const [read, setRead] = useState<ShareLinksControl['read']>('loading');
  const [links, setLinks] = useState<ShareLinkRow[]>([]);
  const [attempt, setAttempt] = useState(0);
  // The list the rows on screen are for: another list's never show.
  const loadedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !listId) return;
    let live = true;
    if (loadedFor.current !== listId) {
      setRead('loading');
      setLinks([]);
    }
    (async () => {
      try {
        const res = await fetch(`/api/wishlists/${listId}/links`, { cache: 'no-store' });
        const result = await res.json();
        if (!live) return;
        if (!res.ok || !result.success || !Array.isArray(result.data)) {
          throw new Error('Unexpected answer');
        }
        loadedFor.current = listId;
        setLinks(result.data);
        setRead('loaded');
      } catch {
        if (!live) return;
        setRead((prev) => (prev === 'loaded' && loadedFor.current === listId ? prev : 'failed'));
      }
    })();
    return () => {
      live = false;
    };
  }, [listId, enabled, attempt]);

  const retry = useCallback(() => {
    setRead('loading');
    setAttempt((n) => n + 1);
  }, []);

  const create = useCallback(
    async (input: NewShareLink): Promise<ShareLinkRow | null> => {
      if (!listId) return null;
      try {
        const res = await fetch(`/api/wishlists/${listId}/links`, {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify(input),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.success) {
          showToast(result.error || 'Couldn’t create the link', 'error');
          return null;
        }
        const row: ShareLinkRow = result.data;
        setLinks((prev) => [row, ...prev.filter((l) => l._id !== row._id)]);
        showToast('Share link created', 'success');
        return row;
      } catch {
        showToast('Couldn’t create the link', 'error');
        return null;
      }
    },
    [listId, showToast]
  );

  const update = useCallback(
    async (id: string, patch: ShareLinkPatch): Promise<boolean> => {
      if (!listId) return false;
      try {
        const res = await fetch(`/api/wishlists/${listId}/links/${id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify(patch),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.success) {
          showToast(result.error || 'Couldn’t save the link', 'error');
          return false;
        }
        const saved: ShareLinkRow = result.data;
        // The answer carries no token: keep the one the row has.
        setLinks((prev) => prev.map((l) => (l._id === id ? { ...saved, token: l.token } : l)));
        showToast('Link saved', 'success');
        return true;
      } catch {
        showToast('Couldn’t save the link', 'error');
        return false;
      }
    },
    [listId, showToast]
  );

  const revoke = useCallback(
    async (id: string): Promise<boolean> => {
      if (!listId) return false;
      try {
        const res = await fetch(`/api/wishlists/${listId}/links/${id}`, { method: 'DELETE' });
        const result = await res.json().catch(() => ({}));
        // Already gone (a co-owner revoked it): it's what was asked for.
        if (!res.ok && !(res.status === 404 && result.error === 'Link not found')) {
          showToast(result.error || 'Couldn’t revoke the link', 'error');
          return false;
        }
        setLinks((prev) => prev.filter((l) => l._id !== id));
        showToast('Link revoked', 'success');
        return true;
      } catch {
        showToast('Couldn’t revoke the link', 'error');
        return false;
      }
    },
    [listId, showToast]
  );

  const now = new Date();
  const liveCount = links.filter((l) => isLinkLive(l, now)).length;
  return { read, links, liveCount, retry, create, update, revoke };
}
