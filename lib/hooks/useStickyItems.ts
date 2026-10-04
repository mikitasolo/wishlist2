'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addPin, keepPinnedInPlace } from '@/lib/utils/stickyItems';

interface Identified {
  _id: string;
}

interface Pins {
  view: string;
  pinned: string[];
  anchor: string[];
}

/**
 * The items a list shows, with each card the viewer has just changed kept in
 * its slot (WIS-297, `lib/utils/stickyItems.ts`). `fresh` is what the chip,
 * search and sort would show, `all` every item as last read, and `view` names
 * the chip, search, sort and list together: once it changes, every pin goes.
 * Call `pin(id)` before the change is applied, so the card never moves, not
 * even for the render the optimistic update makes.
 */
export function useStickyItems<T extends Identified>(
  fresh: T[],
  all: readonly T[],
  view: string
): { items: T[]; pin: (id: string) => void } {
  const [pins, setPins] = useState<Pins>({ view, pinned: [], anchor: [] });
  // A new view drops the pins for good: going back to the chip they were made
  // on mustn't bring them back.
  if (pins.view !== view) setPins({ view, pinned: [], anchor: [] });
  const current = pins.view === view ? pins : null;

  const items = useMemo(
    () =>
      current && current.pinned.length > 0
        ? keepPinnedInPlace(fresh, all, current.pinned, current.anchor)
        : fresh,
    [current, fresh, all]
  );

  // What's on screen and under which view, for a pin made from an event (a
  // click, a toast's Undo) whose closure may predate the latest render.
  const shownRef = useRef(items);
  const viewRef = useRef(view);
  useEffect(() => {
    shownRef.current = items;
    viewRef.current = view;
  }, [items, view]);

  const pin = useCallback((id: string) => {
    const shown = shownRef.current.map((item) => item._id);
    const nowView = viewRef.current;
    setPins((prev) => ({
      view: nowView,
      ...addPin(prev.view === nowView ? prev.pinned : [], id, shown),
    }));
  }, []);

  return { items, pin };
}
