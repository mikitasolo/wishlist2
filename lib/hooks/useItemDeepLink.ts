'use client';

import { useEffect, useState } from 'react';
import { ITEM_PARAM, itemAnchorId } from '@/lib/utils/itemDeepLink';

interface ItemDeepLinkInput {
  /** The id or slug the page's URL names the list by: a new list reads the URL afresh. */
  listKey: string | null;
  /** Whether the viewer's items have been read, and the grid they're shown in is on screen. */
  ready: boolean;
  /** Every item the viewer was given (whatever the chip or search), by id. */
  itemIds: readonly string[];
  /** Whether the item's card is in the grid under the current chip and search. */
  isShown: (itemId: string) => boolean;
  /** Clears the chip and the search, so every item the viewer has is in the grid. */
  reveal: () => void;
}

/**
 * `?item=<id>` on a list's page (WIS-263): once the items are read, scroll to
 * that item's card and highlight it, first clearing a chip or search that
 * would hide it. An id the viewer wasn't given (unknown, or not theirs to see:
 * a draft, someone else's proposal) does nothing, so the link says no more
 * than the list itself. It's acted on once per list the page opens, so a poll
 * or a chip picked later doesn't scroll back to it, and the highlight goes at
 * the viewer's first click or key press. The URL is left as it is.
 *
 * Returns the id of the item to highlight, or `null`.
 */
export function useItemDeepLink({
  listKey,
  ready,
  itemIds,
  isShown,
  reveal,
}: ItemDeepLinkInput): string | null {
  // The item the URL asked for, until it's been acted on, keyed on the list.
  const [target, setTarget] = useState<{ listKey: string; itemId: string } | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);

  // Read once per list (the browser's URL, so never in a server render).
  useEffect(() => {
    setHighlighted(null);
    if (!listKey) {
      setTarget(null);
      return;
    }
    const itemId = new URLSearchParams(window.location.search).get(ITEM_PARAM);
    setTarget(itemId ? { listKey, itemId } : null);
  }, [listKey]);

  const pending = target && target.listKey === listKey ? target.itemId : null;
  const known = !!pending && itemIds.includes(pending);
  const shown = known && isShown(pending!);

  useEffect(() => {
    if (!pending || !ready) return;
    if (!known) {
      // Not on the list, or not the viewer's to see: nothing to point at.
      setTarget(null);
      return;
    }
    if (!shown) {
      // Hidden by a chip or a search: show everything, then come back here.
      reveal();
      return;
    }
    setTarget(null);
    setHighlighted(pending);
    document
      .getElementById(itemAnchorId(pending))
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [pending, ready, known, shown, reveal]);

  // The highlight has done its job once the viewer does something.
  useEffect(() => {
    if (!highlighted) return;
    const clear = () => setHighlighted(null);
    window.addEventListener('pointerdown', clear, { once: true });
    window.addEventListener('keydown', clear, { once: true });
    return () => {
      window.removeEventListener('pointerdown', clear);
      window.removeEventListener('keydown', clear);
    };
  }, [highlighted]);

  return highlighted;
}
