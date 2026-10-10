import { tourSteps } from '@/lib/utils/tourSteps';
import type { TourStep } from '@/lib/utils/tourSteps';

// The walkthrough's tab-wide state, apart from the component so that code which
// only reports an event (`CreateWishlistModal`) doesn't pull the whole tour in:
// `AppHeader` loads `Walkthrough` lazily (WIS-438).

export interface TourRun {
  steps: TourStep[];
  /** What the steps were built for, to build them again when that changes. */
  desktop: boolean;
  index: number;
  /** A list of their own for the steps about it (`WalkthroughStatus.listPath`). */
  listPath: string | null;
  /** This step has been to its page already: it doesn't take them back if they wander. */
  arrived: boolean;
  /** This step's "try it" control was used: the tour moves on once things settle. */
  used: boolean;
}

/** What the tour is built from (`GET /api/users/me`'s walkthrough status). */
export interface TourBasis {
  ownsList: boolean;
  listPath: string | null;
}

export interface TourStore {
  run: TourRun | null;
  /** The offer, while it's showing, with what the tour it starts is built from. */
  offer: TourBasis | null;
}

// One tour per tab, across the page changes that remount the header.
let store: TourStore = { run: null, offer: null };
const listeners = new Set<() => void>();
// The account this tab has already read the tour's status for.
let checkedFor: string | null = null;

export function setStore(next: Partial<TourStore>) {
  store = { ...store, ...next };
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getStore(): TourStore {
  return store;
}

export function getCheckedFor(): string | null {
  return checkedFor;
}

export function setCheckedFor(userId: string | null) {
  checkedFor = userId;
}

/**
 * A list was just made (`CreateWishlistModal`): a running tour's steps about
 * their own list go to it, and the closing card no longer offers to make one.
 */
export function tourListCreated(path: string) {
  if (!store.run) return;
  setStore({
    run: {
      ...store.run,
      listPath: path,
      steps: tourSteps({ desktop: store.run.desktop, ownsList: true }),
    },
  });
}

/** Forgets the tab's tour state (tests). */
export function resetWalkthroughForTests() {
  store = { run: null, offer: null };
  checkedFor = null;
  listeners.forEach((listener) => listener());
}
