/**
 * The guided walkthrough's steps (WIS-371, made interactive by WIS-436): one
 * tour for everyone, whether they own lists, are only on friends' ones, or
 * have just signed up. Each step belongs on a page (`page`), which the tour
 * takes them to, and points at the real control there (a `data-tour` target);
 * a "try it" step (`tryIt`) moves on once they use that control. What needs a
 * list they may not have runs on the practice list (`/tour`, made-up data
 * only, nothing sent or saved): reserving always, adding and sharing when
 * they own no list. The picture (`TourIllustration`) is only for the centred
 * card a step falls back to when its target never shows. Never anyone's real
 * reservation. Copy follows the D1 vocabulary (docs/agents/ui.md).
 */

/** The `data-tour` attribute values the tour looks for on the page. */
export type TourTarget =
  | 'new-list'
  | 'add-item'
  | 'share'
  | 'search'
  | 'reserve'
  | 'group-gift'
  | 'reserved'
  | 'no-spoiler'
  | 'bookmarklet';

/**
 * Where a step belongs. `own-list` is the list they're on when it's theirs,
 * else the one `GET /api/users/me` names (`listPath`), else the practice
 * list's owner view; `practice` is its friend's view.
 */
export type TourPage = 'home' | 'own-list' | 'practice' | 'reserved' | 'settings';

/** The practice list (`app/tour`): a friend's list, and one of your own. */
export const PRACTICE_PATH = '/tour';
export const PRACTICE_OWNER_PATH = '/tour/mine';

/** The made-up pictures a step can carry (`components/TourIllustration.tsx`). */
export type TourIllustrationKind = 'list' | 'item' | 'sharing' | 'friends' | 'reserving';

export type TourStepKey =
  | 'lists'
  | 'items'
  | 'sharing'
  | 'friends'
  | 'reserving'
  | 'group_gift'
  | 'reserved'
  | 'no_spoiler'
  | 'bookmarklet'
  | 'closing';

export interface TourStep {
  /** Also what `tour_skipped` reports (lib/analytics.ts), so letters and `_` only. */
  key: TourStepKey;
  title: string;
  body: string;
  /** The page it belongs on: the tour goes there first. None: wherever they are. */
  page?: TourPage;
  /** The real control it points at. */
  target?: TourTarget;
  /** What to do with that control; using it moves the tour on (Next works too). */
  tryIt?: string;
  /** The centred card's picture, made-up data only, for when the target never shows. */
  illustration?: TourIllustrationKind;
  /** Only where dragging a link to the bookmarks bar makes sense (a mouse, from `sm` up). */
  desktopOnly?: boolean;
  /** Offers to start a list: the closing card, for someone who owns none. */
  createList?: boolean;
  /** The closing card: not counted as a step, and closing it finishes the tour. */
  closing?: boolean;
}

/** The Settings card holding the bookmarklet (`BookmarkletCard`'s id). */
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
    page: 'home',
    target: 'new-list',
    tryIt: 'Tap New list to start one, or press Next.',
    illustration: 'list',
  },
  {
    key: 'items',
    title: 'Adding items',
    body: 'Add a link, a price and a photo. Star what you want most so it’s listed first.',
    page: 'own-list',
    target: 'add-item',
    tryIt: 'Tap Add item to try it.',
    illustration: 'item',
  },
  {
    key: 'sharing',
    title: 'Sharing',
    body: 'Share a link or invite people by username. Choose who can see it: Public, Friends or Invite only.',
    page: 'own-list',
    target: 'share',
    tryIt: 'Tap Share to see how.',
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
    body: 'This is a practice list: nothing here is saved. On a friend’s list, reserve what you’ll give. On your own lists you never see what’s reserved or by whom.',
    page: 'practice',
    target: 'reserve',
    tryIt: 'Tap Reserve.',
    illustration: 'reserving',
  },
  {
    key: 'group_gift',
    title: 'Group gifts',
    body: 'Something bigger? Start a group gift and friends chip in together.',
    page: 'practice',
    target: 'group-gift',
    tryIt: 'Open the menu and pick Start a group gift.',
  },
  {
    key: 'reserved',
    title: 'Reserved',
    body: 'Every gift you’ve reserved, across all your friends’ lists, is in one place.',
    target: 'reserved',
    tryIt: 'Tap Reserved.',
  },
  {
    key: 'no_spoiler',
    title: 'No spoiler mode',
    body: 'Showing your screen to someone? No spoiler mode hides reservations until you turn it off.',
    page: 'reserved',
    target: 'no-spoiler',
    tryIt: 'Tap the switch to try it. Tap it again any time to turn it off.',
  },
  {
    key: 'bookmarklet',
    title: 'Add from any store',
    body: 'Drag this button to your bookmarks bar, then click it on any product page to add the item to a list.',
    page: 'settings',
    target: 'bookmarklet',
    desktopOnly: true,
  },
  {
    key: 'closing',
    title: 'That’s it',
    body: 'Coming up on Home shows friends’ birthdays and occasions.',
    page: 'home',
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
 * The address a step belongs on, or null for wherever they are. `listPath` is
 * a list of their own to show (`WalkthroughStatus.listPath`).
 */
export function tourStepPath(step: TourStep, listPath: string | null): string | null {
  switch (step.page) {
    case 'home':
      return '/';
    case 'own-list':
      return listPath ?? PRACTICE_OWNER_PATH;
    case 'practice':
      return PRACTICE_PATH;
    case 'reserved':
      return '/booked';
    case 'settings':
      return '/settings';
    default:
      return null;
  }
}

/**
 * Pages the tour never shows on, or starts from: the sign-in flow, Welcome,
 * the bookmarklet's landing page, a share link (its join flow has dialogs of
 * its own) and the unsubscribe page.
 */
export function tourAllowedOn(pathname: string): boolean {
  return !/^\/(auth|welcome|items\/new|l|unsubscribe)(\/|$)/.test(pathname);
}
