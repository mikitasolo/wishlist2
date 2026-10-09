/**
 * The guided walkthrough's steps (WIS-371): one tour for everyone, whether
 * they own lists, are only on friends' ones, or have just signed up. A step
 * points at the real UI through a `data-tour` target where the page has it on
 * screen, and is a centred card where it doesn't; either way its picture
 * (`TourIllustration`) shows the feature with made-up data, so it makes
 * sense with no list of one's own. Never anyone's real reservation. Copy
 * follows the D1 vocabulary (docs/agents/ui.md).
 */

/** The `data-tour` attribute values the tour looks for on the page. */
export type TourTarget = 'new-list' | 'add-item' | 'share' | 'search' | 'no-spoiler';

/** The made-up pictures a step can carry (`components/TourIllustration.tsx`). */
export type TourIllustrationKind = 'list' | 'item' | 'sharing' | 'friends' | 'reserving';

export type TourStepKey =
  'lists' | 'items' | 'sharing' | 'friends' | 'reserving' | 'reserved' | 'bookmarklet' | 'closing';

export interface TourStep {
  /** Also what `tour_skipped` reports (lib/analytics.ts), so letters and `_` only. */
  key: TourStepKey;
  title: string;
  body: string;
  /** The UI it points at, when the page has it on screen. */
  target?: TourTarget;
  /** Its picture, made-up data only. */
  illustration?: TourIllustrationKind;
  /** Only where dragging a link to the bookmarks bar makes sense (a mouse, from `sm` up). */
  desktopOnly?: boolean;
  /** A link out of the card (the tour carries on over the page it opens). */
  link?: { label: string; href: string };
  /** Offers to start a list: the closing card, for someone who owns none. */
  createList?: boolean;
  /** The closing card: not counted as a step, and closing it finishes the tour. */
  closing?: boolean;
}

/** The Settings card the bookmarklet step links to (`BookmarkletCard`'s id). */
export const BOOKMARKLET_SETTINGS_ID = 'bookmarklet';
/** The Settings card that restarts the tour. */
export const TOUR_SETTINGS_ID = 'tour';

/** Home with this query starts the tour at once (Settings' Take the tour again). */
export const TOUR_PARAM = 'tour';
export const TOUR_START_PATH = `/?${TOUR_PARAM}=start`;

/** Dispatched on Home to open New list (the tour's Create a list). */
export const OPEN_NEW_LIST_EVENT = 'open-new-list';

const STEPS: TourStep[] = [
  {
    key: 'lists',
    title: 'Lists for every occasion',
    body: 'Make a list for a birthday, a wedding or just because. Add its date and your friends get a reminder a week before.',
    target: 'new-list',
    illustration: 'list',
  },
  {
    key: 'items',
    title: 'Adding items',
    body: 'Add a link, a price and a photo. Star what you want most so it’s listed first.',
    target: 'add-item',
    illustration: 'item',
  },
  {
    key: 'sharing',
    title: 'Sharing',
    body: 'Share a link or invite people by username. Choose who can see it: Public, Friends or Invite only.',
    target: 'share',
    illustration: 'sharing',
  },
  {
    key: 'friends',
    title: 'Find your friends',
    body: 'Search for someone by @username and follow them. Follow each other and you’re friends: you’ll see each other’s Friends lists.',
    target: 'search',
    illustration: 'friends',
  },
  {
    key: 'reserving',
    title: 'The surprise stays a surprise',
    body: 'On a friend’s list, reserve what you’ll give, or start a group gift and chip in together. On your own lists you never see what’s reserved or by whom.',
    illustration: 'reserving',
  },
  {
    key: 'reserved',
    title: 'Reserved and No spoiler mode',
    body: 'Gifts you’ve reserved are in Reserved. Showing your screen to someone? Turn on No spoiler mode to hide reservations.',
    target: 'no-spoiler',
  },
  {
    key: 'bookmarklet',
    title: 'Add from any store',
    body: 'Drag the Add to wishlist button from Settings to your bookmarks bar, then click it on any product page.',
    desktopOnly: true,
    link: { label: 'Open Settings', href: `/settings#${BOOKMARKLET_SETTINGS_ID}` },
  },
  {
    key: 'closing',
    title: 'That’s it',
    body: 'Coming up on Home shows friends’ birthdays and occasions.',
    closing: true,
  },
];

/**
 * The tour, without the desktop-only step where it doesn't apply, ending on
 * Create a list for someone who owns no list yet.
 */
export function tourSteps({ desktop, ownsList }: { desktop: boolean; ownsList: boolean }) {
  return STEPS.filter((step) => desktop || !step.desktopOnly).map((step) =>
    step.closing && !ownsList
      ? {
          ...step,
          body: `${step.body} Ready to make your own wishlist, so friends know what to get you?`,
          createList: true,
        }
      : step
  );
}

/** How many of them count as steps ("2 of 6"): the closing card doesn't. */
export function countedSteps(steps: TourStep[]): number {
  return steps.filter((step) => !step.closing).length;
}

/**
 * Pages the tour never shows on, or starts from: the sign-in flow, Welcome,
 * the bookmarklet's landing page, a share link (its join flow has dialogs of
 * its own) and the unsubscribe page.
 */
export function tourAllowedOn(pathname: string): boolean {
  return !/^\/(auth|welcome|items\/new|l|unsubscribe)(\/|$)/.test(pathname);
}
