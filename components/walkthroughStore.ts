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
 * Made at the New list step, it counts as using it, however New list was
 * reached (before the step had found its target, say): on to Adding items
 * in it, not the New list step again over a page with no New list.
 */
export function tourListCreated(path: string) {
  const run = store.run;
  if (!run) return;
  setStore({
    run: {
      ...run,
      listPath: path,
      steps: tourSteps({ desktop: run.desktop, ownsList: true }),
      used: run.used || run.steps[run.index]?.key === 'lists',
    },
  });
}

// A tour running in one tab keeps the account's other tabs from starting it
// over at step 1 (a page opened in a new tab, the bookmarklet's): a heartbeat
// in localStorage, renewed while it runs. Storage can throw or be absent
// (private windows): then every tab is on its own, as before.

const TOUR_TAB_KEY = 'tour-running';
/** How often a tab running the tour renews its heartbeat. */
export const TOUR_BEAT_MS = 5000;
/**
 * How long a heartbeat counts: well past the beat, as a hidden tab's timers
 * are slowed (to once a minute, after a while, in Chrome).
 */
export const TOUR_BEAT_FRESH_MS = 90_000;

const tabId = Math.random().toString(36).slice(2);

interface TourBeat {
  userId: string;
  tab: string;
  at: number;
}

function readBeat(): TourBeat | null {
  try {
    const beat = JSON.parse(localStorage.getItem(TOUR_TAB_KEY) ?? 'null');
    return beat && typeof beat.at === 'number' ? beat : null;
  } catch {
    return null;
  }
}

/** This tab is running the tour for this account. */
export function markTourRunning(userId: string, now = Date.now()) {
  try {
    localStorage.setItem(TOUR_TAB_KEY, JSON.stringify({ userId, tab: tabId, at: now }));
  } catch {
    /* on its own */
  }
}

/** This tab's tour has ended, or the tab is going: its heartbeat goes (another tab's stays). */
export function clearTourRunning() {
  if (readBeat()?.tab !== tabId) return;
  try {
    localStorage.removeItem(TOUR_TAB_KEY);
  } catch {
    /* expires */
  }
}

/** Another tab is running the tour for this account. */
export function tourRunningElsewhere(userId: string, now = Date.now()): boolean {
  const beat = readBeat();
  return (
    !!beat && beat.userId === userId && beat.tab !== tabId && now - beat.at < TOUR_BEAT_FRESH_MS
  );
}

/** Forgets the tab's tour state (tests). */
export function resetWalkthroughForTests() {
  store = { run: null, offer: null };
  checkedFor = null;
  try {
    localStorage.removeItem(TOUR_TAB_KEY);
  } catch {
    /* none */
  }
  listeners.forEach((listener) => listener());
}
