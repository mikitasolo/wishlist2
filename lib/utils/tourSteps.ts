import type { WalkthroughVariant } from '@/lib/utils/walkthrough';

/**
 * The guided walkthrough's steps (WIS-371), per variant. A step points at
 * real UI through a `data-tour` target where the page has it, and is a
 * centred card where it doesn't; it never shows made-up data or anyone's real
 * reservation. Copy follows the D1 vocabulary (docs/agents/ui.md).
 */

/** The `data-tour` attribute values the tour looks for on the page. */
export type TourTarget = 'new-list' | 'add-item' | 'share' | 'items' | 'no-spoiler';

export type TourStepKey =
  | 'lists'
  | 'items'
  | 'bookmarklet'
  | 'sharing'
  | 'surprise'
  | 'reserved'
  | 'closing'
  | 'list'
  | 'group_gifts'
  | 'own_list';

export interface TourStep {
  /** Also what `tour_skipped` reports (lib/analytics.ts), so letters and `_` only. */
  key: TourStepKey;
  title: string;
  body: string;
  /** The UI it points at, when the page has it on screen. */
  target?: TourTarget;
  /** Only where dragging a link to the bookmarks bar makes sense (a mouse, from `sm` up). */
  desktopOnly?: boolean;
  /** A link out of the card (the tour carries on over the page it opens). */
  link?: { label: string; href: string };
  /** The member tour's last step offers to start their own list. */
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

/** Dispatched on Home to open New list (the member tour's Create a list). */
export const OPEN_NEW_LIST_EVENT = 'open-new-list';

const RESERVED_AND_NO_SPOILER: TourStep = {
  key: 'reserved',
  title: 'Reserved and No spoiler mode',
  body: 'Gifts you’ve reserved are in Reserved. Showing your screen to someone? Turn on No spoiler mode to hide reservations.',
  target: 'no-spoiler',
};

const OWNER_STEPS: TourStep[] = [
  {
    key: 'lists',
    title: 'Your lists',
    body: 'Make a list for any occasion. Add its date and your friends get a reminder a week before.',
    target: 'new-list',
  },
  {
    key: 'items',
    title: 'Adding items',
    body: 'Add a link, a price and a photo. Star what you want most so it’s listed first.',
    target: 'add-item',
  },
  {
    key: 'bookmarklet',
    title: 'Add from any store',
    body: 'Drag the Add to wishlist button from Settings to your bookmarks bar, then click it on any product page.',
    desktopOnly: true,
    link: { label: 'Open Settings', href: `/settings#${BOOKMARKLET_SETTINGS_ID}` },
  },
  {
    key: 'sharing',
    title: 'Sharing',
    body: 'Share a link or invite people by username. Choose who can see it: Public, Friends or Invite only.',
    target: 'share',
  },
  {
    key: 'surprise',
    title: 'The surprise stays a surprise',
    body: 'On your own lists you never see what’s reserved or by whom. On friends’ lists you can reserve a gift, or chip in with others as a group gift.',
  },
  RESERVED_AND_NO_SPOILER,
  {
    key: 'closing',
    title: 'That’s it',
    body: 'Coming up shows friends’ birthdays and occasions.',
    closing: true,
  },
];

const MEMBER_STEPS: TourStep[] = [
  {
    key: 'list',
    title: 'This list',
    body: 'Browse the list and reserve what you’ll give. The owner never sees what’s reserved or by whom.',
    target: 'items',
  },
  {
    key: 'group_gifts',
    title: 'Group gifts',
    body: 'Too pricey alone? Start a group gift and others can chip in.',
  },
  RESERVED_AND_NO_SPOILER,
  {
    key: 'own_list',
    title: 'Your own list',
    body: 'Make your own wishlist, so friends know what to get you.',
    createList: true,
  },
];

/** The steps of a variant, without the desktop-only one where it doesn't apply. */
export function tourSteps(variant: WalkthroughVariant, { desktop }: { desktop: boolean }) {
  const steps = variant === 'owner' ? OWNER_STEPS : MEMBER_STEPS;
  return steps.filter((step) => desktop || !step.desktopOnly);
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
