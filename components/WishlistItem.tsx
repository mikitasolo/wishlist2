'use client';

import { memo, useEffect, useMemo, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiItem } from '@/types/api';
import { useSession } from 'next-auth/react';
import { convertedPrice, formatApproxPrice, formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import Icon, { type IconName } from '@/components/Icon';
import Link from 'next/link';
import { RESERVED_PATH } from '@/lib/utils/reserveToast';
import Badge from '@/components/Badge';
import ItemCardView from '@/components/ItemCardView';
import ConfirmDialog from '@/components/ConfirmDialog';
import Menu, { type MenuItem } from '@/components/Menu';
import { statusMeta } from '@/lib/utils/itemStatus';
import { useDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { withoutReservation } from '@/lib/utils/discreet';
import IconButton from '@/components/IconButton';
import ItemSheet from '@/components/ItemSheet';
import RelatedItemChips from '@/components/RelatedItemChips';
import type { ItemRef } from '@/lib/utils/itemLinks';
import {
  buttonClassName,
  iconButtonClassName,
  type ButtonVariant,
} from '@/components/buttonStyles';
import {
  cardMenuActions,
  linkSlot,
  savesAsPrimary,
  type CardActionContext,
} from '@/lib/utils/itemCardActions';
import { SM_UP_QUERY, useMediaQuery } from '@/lib/hooks/useMediaQuery';
import GroupGiftProgress from '@/components/GroupGiftProgress';
import GroupGiftDialog, { type GroupGiftDialogResult } from '@/components/GroupGiftDialog';
import type { GroupGiftAction } from '@/lib/utils/groupGiftClient';
import { useCardMotion } from '@/lib/hooks/useCardMotion';
import { onItemCardCue, type CardMotion } from '@/lib/utils/motion';

/**
 * The moment a group gift action plays once it succeeds (WIS-407): taking part
 * is a reserve, stepping out a release, the organizer's give the given moment.
 * A pledge change plays none, nor a convert: the item stays theirs, as it was.
 */
const GROUP_GIFT_MOTION: Record<GroupGiftAction['type'], CardMotion | null> = {
  start: 'reserve',
  join: 'reserve',
  convert: null,
  pledge: null,
  leave: 'release',
  cancel: 'release',
  give: 'given',
};

// The card's actions are one row, the same height on every card: one labelled
// primary action, then the product link as a square icon button (unless the
// link is the primary), then a "More actions" menu with the rest.
//
// Below `sm` the grid has two columns, and the row is just [primary] [⋯]: the
// link square folds into the menu as "Open product page". CSS does it on the
// first paint (the square is `max-sm:hidden`, and a menu that holds only the
// link is `sm:hidden`), so the server's HTML is right at every width and
// hydration never disagrees with it. Once the width is known (`useMediaQuery`),
// what CSS hides is dropped from the DOM, and the menu, whose items are only
// rendered while it's open, offers the link below `sm` only. Nothing hidden is
// ever focusable: `display: none` takes it out of the tab order and the
// accessibility tree.
// The primary is a `md` (40px) `Button` that fills the row: it shrinks with the
// card (tighter padding below `sm`), is a size container for its icon (below),
// and, while its status change is in flight, is held with `aria-disabled`.
const PRIMARY_EXTRAS =
  'min-w-0 flex-1 @container gap-1! px-1.5! sm:gap-1.5! sm:px-3! aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:active:scale-100';

// The primary's icon gives way to its label where the button is too narrow
// for both (a two-column card on a phone narrower than about 390px): the
// button is a size container, so this follows its own width.
const PRIMARY_ICON = 'flex-shrink-0 @max-[5.25rem]:hidden';

const PRIMARY_TONES = {
  // Reserve: the success fill of the "Reserved by you" badge.
  book: { variant: 'success' },
  // Publishing, reviewing, opening the product page.
  primary: { variant: 'primary' },
  // Editing: always there for an owner, so it doesn't shout.
  soft: { variant: 'soft' },
  // Undoing your own booking.
  neutral: { variant: 'cancel' },
  // A gift you've given: done, in the success tone of your booking. Disabled,
  // but not dimmed: it's a state, not an unavailable action.
  given: { variant: 'success-soft', extra: 'disabled:opacity-100!' },
  // Reserved by someone else: nothing to do.
  off: { variant: 'cancel', extra: 'text-muted-foreground! disabled:opacity-100!' },
} as const satisfies Record<string, { variant: ButtonVariant; extra?: string }>;

const primaryClassName = (tone: keyof typeof PRIMARY_TONES) => {
  const t: { variant: ButtonVariant; extra?: string } = PRIMARY_TONES[tone];
  return `${buttonClassName({ variant: t.variant, size: 'md' })} ${PRIMARY_EXTRAS} ${t.extra ?? ''}`;
};

const ICON_BUTTON = `${iconButtonClassName({ variant: 'secondary', size: 'md' })} aria-expanded:bg-muted aria-expanded:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-60`;

/** The product-link square and the owner's "+ link": from `sm` up only. */
const SM_UP_ONLY = 'max-sm:hidden';

interface PrimaryAction {
  label: string;
  /** Shown instead of `label` below `sm`, where the card is narrow. */
  shortLabel?: string;
  /** The accessible name, which starts from (or contains) `label`. */
  ariaLabel: string;
  icon: IconName;
  tone: keyof typeof PRIMARY_TONES;
  onClick: () => void;
  /**
   * Changes the item's status (Reserve, Release, Publish), so it's held while
   * the card's update runs. Edit and Review aren't, as they never were.
   */
  changesStatus?: boolean;
  /**
   * Nothing the viewer can do here (an item someone else booked, a gift they've
   * given): really disabled.
   */
  unavailable?: boolean;
}

interface WishlistItemProps {
  item: ApiItem;
  // Resolves once the update settles; the card ignores what it resolves with.
  onUpdate: (id: string, updates: Partial<ApiItem>) => Promise<unknown>;
  onEdit?: (item: ApiItem) => void;
  onReview?: (item: ApiItem) => void;
  /** "Save to my list": shown when given (the page decides who may copy what). */
  onSaveToList?: (item: ApiItem) => void;
  /**
   * An owner's Delete (or Decline on a proposal), asked once confirmed.
   * Rejects when the delete fails (the page has said so).
   */
  onDelete?: (item: ApiItem) => Promise<void>;
  /** "+ link": opens Edit on the Link field, for an owner's item with no link. */
  onAddLink?: (item: ApiItem) => void;
  isAuthenticated: boolean;
  isOwner?: boolean;
  isMember?: boolean;
  /** Currency to display prices in: 'original' keeps the item's own currency. */
  priceCurrency?: string;
  /** Exchange rates (code → units per USD) for converting when a currency is picked. */
  rates?: Record<string, number> | null;
  /**
   * Shown faded, as an item nobody can act on any more is under All (received,
   * or reserved by someone else: `isDimmedInAll`). Full strength again under
   * the pointer or with focus inside, so it's still readable and usable.
   */
  dimmed?: boolean;
  /** Outlined, as the item a link to it (`?item=`) pointed at; never dimmed then. */
  highlighted?: boolean;
  /**
   * "Goes with" (WIS-29): the partners to show, the ones the viewer is shown
   * on the page (the page filters `item.relatedItems`, e.g. for an owner's
   * Preview as visitor). The card shows 2 and "+N more"; the sheet shows all.
   */
  related?: readonly ItemRef[];
  /** Goes to a partner on the page (scrolls to it and highlights it). */
  onShowItem?: (itemId: string) => void;
  /**
   * Group gifts (WIS-362): sends one action on the item (start, join, change
   * pledge, leave, cancel, convert, give). Given only where a member may use
   * them; resolves once it settles, and the page has said if it failed.
   */
  onGroupGift?: (id: string, action: GroupGiftAction) => Promise<unknown>;
  /**
   * An owner's Select mode (WIS-386): the card is one checkbox over all of it,
   * and none of its own actions can be reached. With no `onToggleSelect` the
   * item can't be picked (a proposal), and the card is only covered.
   */
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  /** The card's batch is in flight (`useBusyIds`): it can't be picked again yet. */
  selectBusy?: boolean;
  /**
   * `data-tour` names for the card's primary action and its More actions menu,
   * for the guided walkthrough to point at (the practice list's, WIS-436).
   */
  tourTargets?: { primary?: string; menu?: string };
}

/** How many "Goes with" chips the card shows before "+N more". */
export const CARD_RELATED_LIMIT = 2;

/**
 * What each way of ending a group gift asks (WIS-362), worded to match what
 * the server does to the others' reservations (`organizerAction`): convert
 * releases them, give moves them into gift history. Leave and cancel ask
 * nothing: they're offered back with Undo before anything is sent (WIS-387).
 */
const GIFT_CONFIRM = {
  give: {
    title: 'Mark as given?',
    message:
      'The group gift ends. Everyone in it gets this gift in their history with their pledge, and their reservations move there.',
    confirm: 'Mark as given',
  },
  convert: {
    title: 'Reserve it just for you?',
    message:
      'The group gift ends and the reservation is yours alone. Everyone else’s reservation of it is released, and their pledges are dropped.',
    confirm: 'Reserve for me',
  },
} as const;

const NO_RELATED: readonly ItemRef[] = [];

function WishlistItem({
  item: shownItem,
  onUpdate,
  onEdit,
  onReview,
  onSaveToList,
  onDelete,
  onAddLink,
  isAuthenticated,
  isOwner = false,
  isMember = false,
  priceCurrency = 'original',
  rates = null,
  dimmed = false,
  highlighted = false,
  related = NO_RELATED,
  onShowItem,
  onGroupGift,
  selectMode = false,
  selected = false,
  onToggleSelect,
  selectBusy = false,
  tourTargets,
}: WishlistItemProps) {
  const { data: session } = useSession();
  // Discreet mode (WIS-46): a member's card is drawn as plain available, with
  // nothing to reserve or release, whatever the item's state. The item itself
  // (and the poll's updates to it) is left as it is.
  const { discreet } = useDiscreetMode();
  const hideBooking = discreet && isMember && !isOwner;
  const item = useMemo(
    () => (hideBooking ? withoutReservation(shownItem) : shownItem),
    [hideBooking, shownItem]
  );
  // The item's details (ItemSheet), opened from the card's body.
  const [sheetOpen, setSheetOpen] = useState(false);
  const bodyButtonRef = useRef<HTMLButtonElement>(null);
  // Closes the sheet for one of the page's dialogs (Edit, Review, Save to my
  // list, + link). Focus goes to the card's body first, so that dialog records
  // the card as its opener and gives focus back to it, rather than to a
  // control of the sheet that's gone by then.
  const closeSheetForDialog = useCallback(() => {
    bodyButtonRef.current?.focus();
    setSheetOpen(false);
  }, []);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showCompleteConfirm, setShowCompleteConfirm] = useState(false);
  const [showToDraftConfirm, setShowToDraftConfirm] = useState(false);
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  // A group gift's pledge dialog, and the confirmation of what ends it.
  const [giftDialog, setGiftDialog] = useState<'start' | 'join' | 'pledge' | null>(null);
  const [giftConfirm, setGiftConfirm] = useState<'give' | 'convert' | null>(null);

  const isBookedByCurrentUser = useMemo(
    () => item.bookedBy && session?.user?.id && item.bookedBy === session.user.id,
    [item.bookedBy, session?.user?.id]
  );

  // A gift the member booked and has since marked as given (only a member's own
  // read of the list carries `givenByMe`). It stays booked by them, but isn't
  // offered back up with Release: releasing it is in the menu, behind a warning.
  const isGivenByCurrentUser =
    !isOwner && item.status === 'booked' && !!isBookedByCurrentUser && item.givenByMe === true;

  const isProposedByCurrentUser = useMemo(
    () =>
      item.status === 'proposed' &&
      item.proposedBy &&
      session?.user?.id &&
      item.proposedBy === session.user.id,
    [item.status, item.proposedBy, session?.user?.id]
  );

  // The group gift on the item, as this member may see it (never an owner's, and
  // not drawn in discreet mode: `withoutReservation` has taken it off `item`).
  const gift = !isOwner && isMember ? item.groupGift : undefined;
  const inGroup = gift?.contributing === true;
  const giftRole: 'organizer' | 'contributor' | null =
    gift?.contributing === true ? (gift.organizer ? 'organizer' : 'contributor') : null;
  const holdsItem = !!isBookedByCurrentUser || inGroup;

  // How the item's status looks to this viewer. For owners, a booked item is
  // available (bookings are hidden), so they never get a booked badge or border.
  const status = statusMeta(item.status, isOwner ? 'owner' : isMember ? 'member' : 'visitor', {
    bookedByViewer: holdsItem,
  });

  // The cover links to the product page.
  const productLink = item.link || null;

  // Price to display: the item's own, exactly, or converted to the picked
  // currency, which is only approximate ("≈ €247"), so the original goes under
  // it. Without the rate (yet), the original alone.
  const locale = useViewerLocale();
  const converted = useMemo(
    () => (item.price ? convertedPrice(item.price, priceCurrency, rates) : null),
    [item.price, priceCurrency, rates]
  );
  const priceText = item.price
    ? converted
      ? formatApproxPrice(converted, locale)
      : formatPrice(item.price, locale)
    : null;
  const originalPriceText = item.price && converted ? formatPrice(item.price, locale) : null;

  // The card's moment (WIS-407), played only once the viewer's own action has
  // succeeded (an update resolves null when it failed), never from a change in
  // the item: so a poll's, or a co-owner's, plays nothing. A reservation's is
  // never an owner's or discreet mode's (`useCardMotion`).
  const { motion, play } = useCardMotion({ isOwner, discreet });
  // An owner's Accept on this proposal, from the review dialog (`cueItemCard`).
  useEffect(
    () => (isOwner ? onItemCardCue(shownItem._id, () => play('cue')) : undefined),
    [isOwner, shownItem._id, play]
  );

  const handleToggleBooked = useCallback(async () => {
    if (isOwner || isUpdating) return;
    setIsUpdating(true);
    try {
      const newStatus = item.status === 'booked' ? 'available' : 'booked';
      const updated = await onUpdate(item._id, { status: newStatus });
      if (updated) play(newStatus === 'booked' ? 'reserve' : 'release');
    } finally {
      setIsUpdating(false);
    }
  }, [item.status, item._id, onUpdate, isOwner, isUpdating, play]);

  const applyStatus = useCallback(
    async (newStatus: 'completed' | 'available' | 'draft', moment: CardMotion | null = null) => {
      setIsUpdating(true);
      try {
        const updated = await onUpdate(item._id, { status: newStatus });
        if (updated && moment) play(moment);
      } finally {
        setIsUpdating(false);
      }
    },
    [item._id, onUpdate, play]
  );

  // A content edit of `mostWanted` alone: never the status.
  const handleToggleMostWanted = useCallback(async () => {
    if (!isOwner || isUpdating) return;
    setIsUpdating(true);
    try {
      await onUpdate(item._id, { mostWanted: !item.mostWanted });
    } finally {
      setIsUpdating(false);
    }
  }, [isOwner, isUpdating, item._id, item.mostWanted, onUpdate]);

  // Delete / Decline: no confirmation, the page takes the item off at once and
  // offers Undo before anything is sent (WIS-387).
  const handleDelete = useCallback(() => {
    onDelete?.(item).catch(() => {
      // The page has said why; the item stays listed.
    });
  }, [onDelete, item]);

  // Releasing a gift already marked as given, once confirmed. Only ever an
  // unbook: if a poll has shown the item isn't theirs any more while the
  // warning was open, there's nothing left to release.
  const handleRelease = useCallback(() => {
    if (isOwner || isUpdating || item.status !== 'booked' || !isBookedByCurrentUser) return;
    applyStatus('available', 'release');
  }, [isOwner, isUpdating, item.status, isBookedByCurrentUser, applyStatus]);

  // A group gift action, held like the card's other updates while it runs.
  const runGroupGift = useCallback(
    async (action: GroupGiftAction) => {
      // Not held on `isUpdating`: the dialog or confirmation that asked has closed,
      // so a dropped call would lose what was typed with no word.
      if (!onGroupGift) return;
      setIsUpdating(true);
      try {
        const updated = await onGroupGift(item._id, action);
        const moment = GROUP_GIFT_MOTION[action.type];
        if (updated && moment) play(moment);
      } finally {
        setIsUpdating(false);
      }
    },
    [onGroupGift, item._id, play]
  );
  const handleGiftDialog = (result: GroupGiftDialogResult) => {
    if (giftDialog === 'start') {
      runGroupGift({ type: 'start', pledged: result.pledged, target: result.target });
    } else if (giftDialog) {
      runGroupGift({ type: giftDialog, pledged: result.pledged });
    }
  };

  const handleToggleCompleted = useCallback(() => {
    if (!isOwner || isUpdating) return;
    if (item.status === 'completed') {
      // Un-completing is reversible → no confirmation needed
      applyStatus('available');
    } else {
      setShowCompleteConfirm(true);
    }
  }, [isOwner, isUpdating, item.status, applyStatus]);

  // Publishing a draft is safe (drafts aren't visible to anyone else yet).
  const handlePublish = useCallback(() => {
    if (!isOwner || isUpdating) return;
    applyStatus('available', 'cue');
  }, [isOwner, isUpdating, applyStatus]);

  // Moving a live item back to draft asks first: it may already be reserved
  // (owners can't see that), and drafting it hides it and frees it on the list,
  // though the gifter keeps their reservation.
  const handleMoveToDraft = useCallback(() => {
    if (!isOwner || isUpdating) return;
    setShowToDraftConfirm(true);
  }, [isOwner, isUpdating]);

  const isProposed = item.status === 'proposed';
  const isDraft = item.status === 'draft';
  // Live (available, or booked as far as a member can tell) or completed.
  const isPublished = !isProposed && !isDraft;
  const isCompleted = status.status === 'completed';

  // true from `sm` up, false below it, null until known (in the server render
  // and the one that hydrates it): see the comment on the action row.
  const smUp = useMediaQuery(SM_UP_QUERY);

  // The one labelled action, by role and state. None (null) means the product
  // link takes its place: for signed-out visitors, signed-in non-members, and
  // a member on an item they can't book (completed).
  let primary: PrimaryAction | null = null;
  if (isAuthenticated && isOwner) {
    if (isProposed && onReview) {
      primary = {
        label: 'Review',
        ariaLabel: 'Review proposed item',
        icon: 'check-circle',
        tone: 'primary',
        onClick: () => onReview(item),
      };
    } else if (isDraft) {
      primary = {
        label: 'Publish',
        ariaLabel: 'Publish item',
        icon: 'globe',
        tone: 'primary',
        onClick: handlePublish,
        changesStatus: true,
      };
    } else if (isPublished && onEdit) {
      primary = {
        label: 'Edit',
        ariaLabel: 'Edit item',
        icon: 'edit',
        tone: 'soft',
        onClick: () => onEdit(item),
      };
    }
  } else if (isAuthenticated && isProposedByCurrentUser && onEdit) {
    primary = {
      label: 'Edit',
      ariaLabel: 'Edit proposed item',
      icon: 'edit',
      tone: 'soft',
      onClick: () => onEdit(item),
    };
  } else if (hideBooking) {
    // Discreet mode: no reserve control, and no disabled one to give it away.
  } else if (isAuthenticated && isMember && item.status === 'available') {
    primary = {
      label: 'Reserve',
      ariaLabel: 'Reserve this item',
      icon: 'gift',
      tone: 'book',
      onClick: handleToggleBooked,
      changesStatus: true,
    };
  } else if (isAuthenticated && isMember && item.status === 'booked' && gift && onGroupGift) {
    // A group gift (WIS-362): join it, or change your pledge. Leaving and the
    // organizer's endings are in the menu.
    primary = inGroup
      ? {
          label: 'Change pledge',
          shortLabel: 'Pledge',
          ariaLabel: 'Change your pledge',
          icon: 'edit',
          tone: 'soft',
          onClick: () => setGiftDialog('pledge'),
        }
      : {
          label: 'Join',
          ariaLabel: 'Join this group gift',
          icon: 'users',
          tone: 'book',
          onClick: () => setGiftDialog('join'),
        };
  } else if (isAuthenticated && isMember && item.status === 'booked') {
    // Owners never get here: for them a booked item is just available.
    primary = isGivenByCurrentUser
      ? {
          label: 'Given by you',
          shortLabel: 'Given',
          ariaLabel: 'Given by you',
          icon: 'check-circle',
          tone: 'given',
          onClick: () => {},
          unavailable: true,
        }
      : isBookedByCurrentUser
        ? {
            label: 'Release',
            ariaLabel: 'Release this item',
            icon: 'undo',
            tone: 'neutral',
            onClick: handleToggleBooked,
            changesStatus: true,
          }
        : {
            label: 'Reserved',
            ariaLabel: 'This item is already reserved',
            icon: 'lock',
            tone: 'off',
            onClick: () => {},
            unavailable: true,
          };
  }

  // The actions beyond the primary come from one place (itemCardActions), so
  // anything that reuses the card's actions reads the same set.
  const actionContext: CardActionContext = {
    isAuthenticated,
    isOwner,
    isMember,
    status: item.status,
    isCompleted,
    isGivenByViewer: isGivenByCurrentUser,
    hasLink: !!item.link,
    canEdit: !!onEdit,
    canSave: !!onSaveToList,
    canDelete: !!onDelete,
    canAddLink: !!onAddLink,
    canStartGroupGift: !!onGroupGift && !hideBooking && item.status === 'available',
    groupGiftRole: onGroupGift ? giftRole : null,
  };
  // No link and nothing else to do with it: a signed-in non-member saves the
  // item instead, as the primary.
  if (!primary && onSaveToList && savesAsPrimary(actionContext)) {
    primary = {
      label: 'Save to my list',
      shortLabel: 'Save',
      ariaLabel: 'Save to my list',
      icon: 'plus',
      tone: 'soft',
      onClick: () => onSaveToList(item),
    };
    actionContext.primaryIsSave = true;
  }

  // Moving a completed item to draft isn't offered (it never was), and drafts
  // and other people's proposals can't be copied (the page gives no
  // `onSaveToList` for them). The status changes are held while the card's
  // update runs; Edit and Save to my list aren't.
  const menuActions = cardMenuActions(actionContext);
  const menuItems: MenuItem[] = menuActions.map((action): MenuItem => {
    switch (action) {
      case 'markReceived':
        return {
          label: isCompleted ? 'Mark as not received' : 'Mark as received',
          icon: isCompleted ? 'undo' : 'check-circle',
          onSelect: handleToggleCompleted,
          disabled: isUpdating,
        };
      case 'moveToDraft':
        return {
          label: 'Move to draft',
          icon: 'note',
          onSelect: handleMoveToDraft,
          disabled: isUpdating,
        };
      case 'editDraft':
        return { label: 'Edit', icon: 'edit', onSelect: () => onEdit?.(item) };
      case 'mostWanted':
        return {
          label: item.mostWanted ? 'Not most wanted' : 'Mark as most wanted',
          icon: 'star',
          onSelect: handleToggleMostWanted,
          disabled: isUpdating,
        };
      case 'releaseGiven':
        return {
          label: 'Release',
          icon: 'undo',
          onSelect: () => setShowReleaseConfirm(true),
          disabled: isUpdating,
        };
      case 'startGroupGift':
        return {
          label: 'Start a group gift',
          icon: 'users',
          onSelect: () => setGiftDialog('start'),
          disabled: isUpdating,
        };
      case 'giveGroupGift':
        return {
          label: 'Mark as given',
          icon: 'check-circle',
          onSelect: () => setGiftConfirm('give'),
          disabled: isUpdating,
        };
      case 'convertGroupGift':
        return {
          label: 'Reserve it just for me',
          icon: 'gift',
          onSelect: () => setGiftConfirm('convert'),
          disabled: isUpdating,
        };
      case 'leaveGroupGift':
        return {
          label: 'Leave group gift',
          icon: 'logout',
          onSelect: () => runGroupGift({ type: 'leave' }),
          disabled: isUpdating,
        };
      case 'cancelGroupGift':
        return {
          label: 'Cancel group gift',
          icon: 'close',
          onSelect: () => runGroupGift({ type: 'cancel' }),
          disabled: isUpdating,
          separated: true,
          danger: true,
        };
      case 'saveToList':
        return {
          label: 'Save to my list',
          icon: 'plus',
          onSelect: () => onSaveToList?.(item),
          separated: true,
        };
      case 'decline':
        return {
          label: 'Decline',
          icon: 'trash',
          onSelect: handleDelete,
          separated: true,
          danger: true,
        };
      case 'delete':
        return {
          label: 'Delete',
          icon: 'trash',
          onSelect: handleDelete,
          separated: true,
          danger: true,
        };
    }
  });

  // The product page opens in a new tab, from the primary action or the link button.
  const productPage = item.link
    ? {
        href: item.link,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `View ${item.name} product page`,
      }
    : null;

  // Below `sm`, the link square folds into the menu, as its first item. When
  // the link is the primary action, there's no square to fold.
  const linkFolds = !!primary && !!item.link;
  // Until the width is known the link is in it too, so a menu that CSS shows
  // below `sm` for it is never an empty one. (Items only render while it's
  // open, by when the width is known.)
  const rowMenuItems: MenuItem[] =
    linkFolds && smUp !== true
      ? [
          { label: 'Open product page', icon: 'external-link', href: item.link!, external: true },
          ...menuItems,
        ]
      : menuItems;
  const showMenu = menuItems.length > 0 || (linkFolds && smUp !== true);
  // A menu holding nothing but the folded link is there below `sm` only.
  const menuBelowSmOnly = menuItems.length === 0;
  const slot = linkSlot(actionContext);
  const showLinkSquare = !!primary && smUp !== false;

  // The primary action, on the card or in its sheet. Reserved by someone else
  // is really disabled. A status change held while this card's update runs
  // only looks it, so focus on it stays put. In the sheet, the label is never
  // shortened (it's as wide as the screen), and an action that opens a dialog
  // of the page's (Edit, Review, Save to my list) closes the sheet first, so
  // that dialog isn't stacked over it.
  const primaryButton = (action: PrimaryAction, inSheet = false) => (
    <button
      type="button"
      onClick={() => {
        if (action.changesStatus && isUpdating) return;
        if (inSheet && !action.changesStatus) closeSheetForDialog();
        action.onClick();
      }}
      disabled={action.unavailable}
      aria-disabled={action.changesStatus && isUpdating ? true : undefined}
      aria-label={action.ariaLabel}
      className={primaryClassName(action.tone)}
      data-tour={inSheet ? undefined : tourTargets?.primary}
    >
      <Icon name={action.icon} size={16} className={PRIMARY_ICON} />
      {action.shortLabel && !inSheet ? (
        <>
          <span className="truncate sm:hidden">{action.shortLabel}</span>
          <span className="truncate max-sm:hidden">{action.label}</span>
        </>
      ) : (
        <span className="truncate">{action.label}</span>
      )}
    </button>
  );

  // The sheet offers the card's actions (the same `cardMenuActions`), less the
  // product link, which it shows with its domain. Those that open one of the
  // page's dialogs close the sheet first; the card's own confirmations open
  // over it.
  const sheetMenuItems: MenuItem[] = menuActions.map((action, i) =>
    action === 'editDraft' || action === 'saveToList'
      ? {
          ...menuItems[i],
          onSelect: () => {
            closeSheetForDialog();
            menuItems[i].onSelect?.();
          },
        }
      : menuItems[i]
  );
  const sheetAddLink = slot === 'add-link' && !!onAddLink;
  const sheetActions =
    primary || sheetAddLink || sheetMenuItems.length > 0 ? (
      <>
        {primary && primaryButton(primary, true)}
        {sheetAddLink && (
          <IconButton
            icon="link-plus"
            label="Add product link"
            title="Add product link"
            variant="secondary"
            size="md"
            onClick={() => {
              closeSheetForDialog();
              onAddLink?.(item);
            }}
          />
        )}
        {sheetMenuItems.length > 0 && (
          <Menu
            label="More actions"
            items={sheetMenuItems}
            triggerClassName={ICON_BUTTON}
            opensAbove
          />
        )}
      </>
    ) : null;

  const rowMenu = (
    <Menu
      label="More actions"
      items={rowMenuItems}
      triggerClassName={ICON_BUTTON}
      className={menuBelowSmOnly ? 'relative flex sm:hidden' : undefined}
    />
  );

  const actionsRow = (
    <div className="mt-auto flex min-h-10 items-center gap-2">
      {primary ? (
        primaryButton(primary)
      ) : productPage ? (
        <a {...productPage} className={primaryClassName('primary')}>
          <Icon name="external-link" size={16} className={PRIMARY_ICON} />
          <span className="truncate">View item</span>
        </a>
      ) : null}

      {/* The product link, when the primary action isn't already it: from
          `sm` up (below it, it's in the menu). */}
      {showLinkSquare && slot === 'link' && productPage && (
        <a {...productPage} className={`${ICON_BUTTON} ${SM_UP_ONLY}`} title="View product page">
          <Icon name="external-link" size={18} />
        </a>
      )}
      {showLinkSquare && slot === 'add-link' && onAddLink && (
        <IconButton
          icon="link-plus"
          label="Add product link"
          title="Add product link"
          variant="secondary"
          size="md"
          onClick={() => onAddLink(item)}
          className={SM_UP_ONLY}
        />
      )}

      {showMenu &&
        (tourTargets?.menu ? (
          <span className="contents" data-tour={tourTargets.menu}>
            {rowMenu}
          </span>
        ) : (
          rowMenu
        ))}
    </div>
  );

  return (
    <ItemCardView
      item={item}
      status={status}
      dimmed={dimmed}
      highlighted={highlighted}
      motion={motion}
      priceText={priceText}
      originalPriceText={originalPriceText}
      onCoverClick={() => setSheetOpen(true)}
      groupGift={gift && <GroupGiftProgress gift={gift} locale={locale} />}
      related={
        related.length > 0 ? (
          <RelatedItemChips
            items={related}
            limit={CARD_RELATED_LIMIT}
            onShow={onShowItem}
            onMore={() => setSheetOpen(true)}
          />
        ) : undefined
      }
      statusBadge={
        holdsItem && !isOwner && item.status === 'booked' ? (
          // Your own reservation's badge leads to Reserved (WIS-260).
          <Link
            href={RESERVED_PATH}
            aria-label="Reserved by you, open Reserved"
            className="max-sm:order-first rounded-full"
          >
            <Badge status={status} className="shadow-sm" />
          </Link>
        ) : undefined
      }
      // The card's body (its name, price and notes) opens the item's details:
      // the name is the button, and its ::after stretches over the rest of the
      // body. The cover opens it too (a pointer target only), and the
      // actions sit outside it. The product link is in the action row, the
      // menu and the sheet.
      title={
        <button
          type="button"
          ref={bodyButtonRef}
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          title={item.name}
          className="block w-full cursor-pointer rounded-md text-left after:absolute after:inset-0 after:content-['']"
        >
          <span className="line-clamp-2">{item.name}</span>
        </button>
      }
      actions={actionsRow}
      contentInert={selectMode}
    >
      {/* The item's details. With the live item, so a poll's update shows in
          it, and it goes with the card when the item is deleted. */}
      {sheetOpen && (
        <ItemSheet
          item={item}
          isOpen
          onClose={() => setSheetOpen(false)}
          status={status}
          price={priceText}
          originalPrice={originalPriceText}
          actions={sheetActions}
          groupGift={gift && <GroupGiftProgress gift={gift} locale={locale} showPeople />}
          related={related}
          onShowItem={
            onShowItem &&
            ((itemId: string) => {
              setSheetOpen(false);
              onShowItem(itemId);
            })
          }
        />
      )}

      {selectMode &&
        (onToggleSelect ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={`Select ${item.name}`}
            aria-disabled={selectBusy || undefined}
            onClick={() => {
              if (!selectBusy) onToggleSelect(item._id);
            }}
            className={`absolute inset-0 z-20 cursor-pointer rounded-3xl ${
              selected ? 'ring-2 ring-primary-600 ring-offset-2 ring-offset-background' : ''
            }`}
          >
            <span
              aria-hidden
              className={`absolute left-2.5 top-2.5 grid size-7 place-items-center rounded-full border-2 shadow-sm sm:left-3 sm:top-3 ${
                selected
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-border-strong bg-surface/90'
              }`}
            >
              {selected && <Icon name="check" size={16} />}
            </span>
          </button>
        ) : (
          // Not pickable (a proposal: that's a review): covered, so nothing on
          // it can be reached while picking.
          <div aria-hidden className="absolute inset-0 z-20 rounded-3xl bg-background/50" />
        ))}

      {/* The confirmations are portalled to <body>, as the sheet is, so one
          asked from the sheet opens over it whatever the card's own stacking
          (a dimmed card's opacity would otherwise trap it under the sheet). */}
      {giftDialog && (
        <GroupGiftDialog
          mode={giftDialog}
          itemName={item.name}
          price={item.price}
          // The gift's currency, which every member's summary carries (a
          // member outside the gift gets the currency only, never an amount).
          currency={gift?.target.currency}
          pledged={
            giftDialog === 'pledge' && gift?.contributing
              ? gift.contributors.find((c) => c.you)?.pledged
              : undefined
          }
          onSubmit={handleGiftDialog}
          onClose={() => setGiftDialog(null)}
        />
      )}

      {(showCompleteConfirm || showToDraftConfirm || showReleaseConfirm || giftConfirm) &&
        createPortal(
          <>
            {giftConfirm && (
              <ConfirmDialog
                isOpen
                title={GIFT_CONFIRM[giftConfirm].title}
                message={GIFT_CONFIRM[giftConfirm].message}
                confirmText={GIFT_CONFIRM[giftConfirm].confirm}
                cancelText="Cancel"
                type="warning"
                onConfirm={() => {
                  const type = giftConfirm;
                  setGiftConfirm(null);
                  runGroupGift({ type });
                }}
                onCancel={() => setGiftConfirm(null)}
              />
            )}

            {showCompleteConfirm && (
              <ConfirmDialog
                isOpen
                title="Mark as received?"
                message="It stays on the list with a ✓ so people know it's taken care of, and nobody can reserve it. You can undo this."
                confirmText="Mark as received"
                cancelText="Cancel"
                type="info"
                onConfirm={() => {
                  setShowCompleteConfirm(false);
                  applyStatus('completed', 'cue');
                }}
                onCancel={() => setShowCompleteConfirm(false)}
              />
            )}

            {showToDraftConfirm && (
              <ConfirmDialog
                isOpen
                title="Move to draft?"
                // An owner's status change frees the item but keeps the gifter's
                // reservation. Read by an owner, so it can't say whether anyone has.
                message="Hide it from everyone else? If someone reserved it, it's released here, but they keep it on their Reserved page."
                confirmText="Move to draft"
                cancelText="Cancel"
                type="warning"
                onConfirm={() => {
                  setShowToDraftConfirm(false);
                  applyStatus('draft');
                }}
                onCancel={() => setShowToDraftConfirm(false)}
              />
            )}

            {showReleaseConfirm && (
              <ConfirmDialog
                isOpen
                title="Release this gift?"
                message="You’ve marked it as given. Once it’s released, someone else on the list could reserve it and buy it again."
                confirmText="Release"
                cancelText="Cancel"
                type="warning"
                onConfirm={() => {
                  setShowReleaseConfirm(false);
                  handleRelease();
                }}
                onCancel={() => setShowReleaseConfirm(false)}
              />
            )}
          </>,
          document.body
        )}
    </ItemCardView>
  );
}

export default memo(WishlistItem);
