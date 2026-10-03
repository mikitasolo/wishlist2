'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import Menu, { type MenuItem } from '@/components/Menu';
import { Skeleton } from '@/components/Skeleton';
import { iconButtonClassName } from '@/components/buttonStyles';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { occasionDetails, occasionKindLabel, type Occasion } from '@/lib/utils/occasion';
import { coverBadge, type Visibility } from '@/lib/utils/visibility';

/** Who's looking at the list: one of its owners, a member, or anyone else (signed in or not). */
export type WishlistViewerRole = 'owner' | 'member' | 'visitor';

/** The ⋯ menu's trigger: square at the action row's height, beside its `sm` pills. */
const MORE_TRIGGER = iconButtonClassName({ variant: 'secondary', size: 'sm', shape: 'pill' });

/** Its accessible name. Not "More actions", which each item card's menu is called. */
export const LIST_MENU_LABEL = 'More list actions';

interface WishlistHeaderProps {
  name: string;
  /** The owners' usernames, primary owner first. An owner without one isn't credited. */
  ownerUsernames: readonly string[];
  /** The viewer's username: credited as "you" when they're one of the owners. */
  viewerUsername?: string | null;
  role: WishlistViewerRole;
  occasion?: Occasion | null;
  visibility?: Visibility | null;
  archived?: boolean | null;
  /** Owners only: whether the viewer has pinned it to their own dashboard (`featuredBy`). */
  pinned?: boolean;
  /** A pin or unpin is on its way: the item is held until it settles. */
  pinning?: boolean;
  onAddItem: () => void;
  onPropose: () => void;
  onTogglePin: () => void;
  /** Leave list…: the page asks to confirm, or tells a sole owner why they can't. */
  onLeave: () => void;
  /**
   * The list's Share (a `ShareButton`, which the page sets up with the list's
   * link and, for an owner, its invite popover), or nothing on an archived
   * list: its link opens for its owners only, so anyone they'd share it with
   * gets the answer a missing list gets.
   */
  share?: ReactNode;
}

/**
 * The top of a wishlist's page, three lines: the list's name, in full (it wraps
 * to up to three lines, never truncated to one), a meta line (its owners, its
 * occasion with the date it falls on, its visibility), and one row of actions
 * for the viewer's role:
 * - an owner: Add item, Share and ⋯ (Pin to my dashboard, Leave list…), with
 *   the list's tabs (Items · People · Settings) under the header, not here;
 * - a member: Propose, Share and ⋯ (Leave list…);
 * - anyone else: Share.
 *
 * On a wide screen the actions sit beside the name.
 */
export default function WishlistHeader({
  name,
  ownerUsernames,
  viewerUsername,
  role,
  occasion,
  visibility,
  archived,
  pinned = false,
  pinning = false,
  onAddItem,
  onPropose,
  onTogglePin,
  onLeave,
  share,
}: WishlistHeaderProps) {
  const isOwner = role === 'owner';
  const menuItems: MenuItem[] = [];
  if (isOwner) {
    menuItems.push({
      label: pinned ? 'Unpin from my dashboard' : 'Pin to my dashboard',
      icon: 'sparkles',
      onSelect: onTogglePin,
      disabled: pinning,
    });
  }
  if (role !== 'visitor') {
    menuItems.push({ label: 'Leave list…', icon: 'logout', onSelect: onLeave });
  }

  return (
    <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
      <div className="min-w-0 lg:flex-1">
        <h1
          title={name}
          className="line-clamp-3 break-words text-3xl font-semibold tracking-tight text-foreground sm:text-4xl"
        >
          {name}
        </h1>
        <WishlistMeta
          ownerUsernames={ownerUsernames}
          viewerUsername={isOwner ? viewerUsername : null}
          occasion={occasion}
          visibility={visibility}
          archived={archived}
        />
      </div>
      <div
        role="group"
        aria-label="List actions"
        className="flex flex-wrap items-center gap-3 lg:flex-shrink-0 lg:pt-0.5"
      >
        {/* Adding claims nothing about the items already there, so it's offered
            while they load too, and from every tab (it goes back to Items). */}
        {isOwner && (
          <Button size="sm" shape="pill" icon="plus" onClick={onAddItem}>
            Add item
          </Button>
        )}
        {role === 'member' && (
          <Button size="sm" shape="pill" icon="plus" onClick={onPropose}>
            Propose
          </Button>
        )}
        {share}
        {menuItems.length > 0 && (
          <Menu label={LIST_MENU_LABEL} items={menuItems} triggerClassName={MORE_TRIGGER} />
        )}
      </div>
    </header>
  );
}

/**
 * The line under a list's name: "by you & @chloe_r", its occasion ("Birthday ·
 * Sat 17 Oct · in 14 days") and its visibility (Public · Friends · Invite
 * only), or Archived on an archived list, which only its owners can open
 * whatever the visibility says.
 */
function WishlistMeta({
  ownerUsernames,
  viewerUsername,
  occasion,
  visibility,
  archived,
}: {
  ownerUsernames: readonly string[];
  /** Set only when the viewer is an owner, so only an owner is ever "you". */
  viewerUsername?: string | null;
  occasion?: Occasion | null;
  visibility?: Visibility | null;
  archived?: boolean | null;
}) {
  const badge = coverBadge({ visibility, archived });
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-muted-foreground">
      {/* Every owner, by their public handle: a co-owned list is equally each one's. */}
      {ownerUsernames.length > 0 && (
        <span>
          by{' '}
          {ownerUsernames.slice(0, 2).map((username, i) => (
            <span key={username}>
              {i > 0 && ' & '}
              {viewerUsername && username === viewerUsername ? (
                'you'
              ) : (
                <Link
                  href={`/users/${username}`}
                  className="font-semibold text-foreground underline-offset-2 hover:underline"
                >
                  @{username}
                </Link>
              )}
            </span>
          ))}
          {ownerUsernames.length > 2 && ` +${ownerUsernames.length - 2}`}
        </span>
      )}
      {occasion && <OccasionMeta occasion={occasion} />}
      <Badge size="sm" icon={badge.icon}>
        {badge.label}
      </Badge>
    </div>
  );
}

/**
 * A list's occasion, the day it next falls on, and the countdown to it, in the
 * viewer's local date: "Birthday · Sat 17 Oct · in 14 days". Until that date is
 * known (a server render, and the render that hydrates it) only the kind shows,
 * the same on both sides. A yearly occasion shows its next occurrence, never
 * the placeholder year it's stored on.
 */
export function OccasionMeta({ occasion }: { occasion: Occasion }) {
  const today = useLocalToday();
  const details = today ? occasionDetails(occasion, today) : null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon name="calendar" size={16} className="flex-shrink-0" />
      <span>
        {details?.kind ?? occasionKindLabel(occasion.kind)}
        {details?.date && details.dateTime && (
          <>
            {' · '}
            <time dateTime={details.dateTime} className="font-semibold text-foreground">
              {details.date}
            </time>
          </>
        )}
        {details?.countdown && ` · ${details.countdown}`}
      </span>
    </span>
  );
}

/** `WishlistHeader` while the list loads, box for box: the name, the meta line, the actions. */
export function WishlistHeaderSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
      <div className="min-w-0 lg:flex-1">
        {/* The name's line (text-3xl, sm:text-4xl) */}
        <div className="flex h-9 items-center sm:h-10">
          <Skeleton className="h-7 w-64 max-w-full sm:h-8" />
        </div>
        {/* The meta line */}
        <div className="mt-2 flex h-5 items-center gap-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex items-center gap-3 lg:pt-0.5">
        <Skeleton className="h-9 w-28 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
        <Skeleton className="h-9 w-9 rounded-full" />
      </div>
    </div>
  );
}
