/**
 * The app's small motion language (WIS-407): a card's state morph when the
 * viewer reserves or releases it, a short check-mark draw and burst when they
 * mark a gift as given, a cue when an owner publishes, accepts a proposal or
 * marks an item received, and the list's cards coming in one after another as
 * it first appears. The keyframes are the "Motion" block of `globals.css`.
 *
 * Every moment is played by the viewer's own successful action, never by a
 * change in the data (a poll's, a co-owner's): so motion can't say anything the
 * card itself doesn't. And reservation motion (reserve, release, given) is
 * never played to an owner, who is booking-blind, nor in discreet mode, which
 * keeps reservations off the screen. Under `prefers-reduced-motion` nothing
 * plays at all: CSS turns the animations off, and `cardMotionFor` answers null
 * so nothing waits for one either.
 */

/** A moment one card plays. */
export type CardMotion = 'reserve' | 'release' | 'given' | 'cue';

/** About a reservation: never an owner's, never in discreet mode. */
const RESERVATION_MOTIONS: ReadonlySet<CardMotion> = new Set(['reserve', 'release', 'given']);

/** How long each moment runs, matching its keyframes in `globals.css`. */
export const MOTION_MS: Record<CardMotion, number> = {
  reserve: 450,
  release: 350,
  given: 600,
  cue: 450,
};

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the viewer asked for reduced motion (false where it can't be known). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * The moment a card plays once the viewer's own `motion` has succeeded, or
 * null for none: reservation motion never for an owner or in discreet mode,
 * and nothing under reduced motion.
 */
export function cardMotionFor(
  motion: CardMotion,
  viewer: { isOwner: boolean; discreet: boolean; reducedMotion: boolean }
): CardMotion | null {
  if (viewer.reducedMotion) return null;
  if (RESERVATION_MOTIONS.has(motion) && (viewer.isOwner || viewer.discreet)) return null;
  return motion;
}

/** The step between two cards' entrances, and how many cards get a later one. */
export const STAGGER_STEP_MS = 40;
export const STAGGER_MAX_STEPS = 8;
/** One card's entrance (`card-in`). */
export const CARD_IN_MS = 320;
/** From the first card's entrance to the last one's end. */
export const STAGGER_TOTAL_MS = STAGGER_STEP_MS * STAGGER_MAX_STEPS + CARD_IN_MS;

/**
 * An owner's own action on an item card that the card answers with its cue
 * (Accept on a proposal, from its review dialog). The card listens for its id
 * (`useCardMotion`); nothing else plays it.
 */
const CUE_EVENT = 'item-card-cue';

export function cueItemCard(itemId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(CUE_EVENT, { detail: itemId }));
}

export function onItemCardCue(itemId: string, play: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === itemId) play();
  };
  window.addEventListener(CUE_EVENT, listener);
  return () => window.removeEventListener(CUE_EVENT, listener);
}

/** Waits out a moment that's playing (none: resolves at once). */
export function waitForMotion(motion: CardMotion | null): Promise<void> {
  if (!motion) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, MOTION_MS[motion]));
}
