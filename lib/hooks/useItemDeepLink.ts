'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
 * `showItem` does the same for an item picked on the page (a "Goes with" chip,
 * WIS-29): scrolls to it and highlights it, clearing a chip or search that
 * hides it; nothing for an item the viewer wasn't given.
 *
 * Returns the id of the item to highlight (or `null`), and `showItem`.
 */
export function useItemDeepLink({ listKey, ready, itemIds, isShown, reveal }: ItemDeepLinkInput): {
  highlightedId: string | null;
  showItem: (itemId: string) => void;
} {
  // The item the URL asked for, until it's been acted on, keyed on the list.
  const [target, setTarget] = useState<{ listKey: string; itemId: string } | null>(null);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  // The card still to scroll to, once it's on the page.
  const scrollTo = useRef<string | null>(null);

  // Read once per list (the browser's URL, so never in a server render).
  useEffect(() => {
    setHighlighted(null);
    scrollTo.current = null;
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
    scrollTo.current = pending;
  }, [pending, ready, known, shown, reveal]);

  // Scrolled to once its card is on the page, which may be a render or two
  // after the items are read (the grid replaces the skeleton). Checked after
  // every render of the page, which is cheap: one lookup by id, until it lands.
  useEffect(() => {
    if (!scrollTo.current) return;
    const card = document.getElementById(itemAnchorId(scrollTo.current));
    if (!card) return;
    scrollTo.current = null;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    card.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  });

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

  const showItem = useCallback(
    (itemId: string) => {
      if (!listKey) return;
      setHighlighted(null);
      setTarget({ listKey, itemId });
    },
    [listKey]
  );

  return { highlightedId: highlighted, showItem };
}
