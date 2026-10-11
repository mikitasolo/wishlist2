/**
 * "Start a new list from this one" (WIS-325): an owner makes a new list from
 * one they own, bringing over its settings and the items they pick. The rules
 * here are pure, so the dialog (`StartFromListModal`) and the route
 * (`/api/wishlists/[id]/copy`) share them.
 *
 * Owners are booking-blind, so nothing here may depend on whether an item is
 * reserved: a booked item is offered, shaped and copied exactly as an
 * available one is, and its copy starts unreserved like every other.
 */
import type { Occasion } from '@/lib/utils/occasion';
import { normalizeCurrency } from '@/lib/utils/currency';
import { uniqueTags } from '@/lib/utils/itemTags';

/** The most items one copy brings over. */
export const COPY_ITEMS_MAX = 100;

/**
 * The statuses of the items a copy may bring over: everything but items marked
 * received (`completed`) and proposals still waiting for review (`proposed`).
 * `booked` is here because owners can't tell it from `available`: leaving it
 * out would tell them which items were reserved.
 */
export const COPYABLE_STATUSES = ['draft', 'available', 'booked'] as const;

/** A copy's status: a draft stays a draft, everything else is available and unreserved. */
export function copiedStatus(status: string): 'draft' | 'available' {
  return status === 'draft' ? 'draft' : 'available';
}

/** The fields of an item a copy of it carries over. */
interface CopiedSource {
  name: string;
  price?: { value: number; currency: string } | null;
  link?: string | null;
  notes?: string | null;
  mostWanted?: boolean;
  tags?: string[] | null;
  status: string;
}

/**
 * What a copy of `item` starts with, on a new list (`/copy`, WIS-325) or on
 * the list it's moved to (WIS-434): its own fields, never a reservation or a
 * proposer. The image, links, list and dates are the caller's.
 *
 * Its tags (WIS-385) come along only to a new list (`withTags`), whose tags
 * are then the source's own, within its cap; a move leaves them behind, since
 * the list it goes to has tags of its own.
 */
export function copiedItemFields(item: CopiedSource, { withTags }: { withTags: boolean }) {
  const tags = withTags ? uniqueTags(item.tags ?? []) : [];
  return {
    name: item.name,
    price: item.price
      ? { value: item.price.value, currency: normalizeCurrency(item.price.currency) }
      : null,
    link: item.link || undefined,
    notes: item.notes || undefined,
    mostWanted: !!item.mostWanted,
    ...(tags.length ? { tags } : {}),
    status: copiedStatus(item.status),
    // Never reserved, never anyone's proposal: a new item to whoever sees it.
    bookedBy: null,
  };
}

/**
 * The occasion the new list's form starts on: a yearly one comes round again,
 * so it's kept; a one-off one has passed or is this list's own, so the owner
 * picks the new one (none until they do).
 */
export function startingCopyOccasion(occasion: Occasion | null | undefined): Occasion | null {
  return occasion?.recurrence === 'yearly' ? occasion : null;
}

/** An item as the picker shows it. */
export interface CopyCandidate {
  _id: string;
  name: string;
  imageUrl: string | null;
  mostWanted: boolean;
  /** Owners see their drafts anyway; nothing else about its status is said. */
  draft: boolean;
}

interface CandidateSource {
  _id: { toString(): string };
  name: string;
  imageUrl?: string | null;
  mostWanted?: boolean;
  status: string;
}

/**
 * The picker's shape of an item: only what the owner already sees on their own
 * list, and nothing that differs between a booked item and an available one
 * (no status but draft, no `bookedBy`, no `proposedBy`).
 */
export function serializeCopyCandidate(item: CandidateSource): CopyCandidate {
  return {
    _id: item._id.toString(),
    name: item.name,
    imageUrl: item.imageUrl || null,
    mostWanted: !!item.mostWanted,
    draft: item.status === 'draft',
  };
}

/**
 * The timings of a copy, lined up so a retry never waits long on an attempt
 * that died. The route gives up copying images after `COPY_IMAGES_BUDGET_MS`
 * and is killed at its `maxDuration` (40 s, in the route file, which must hold
 * it as a literal); a copy still unfinished `COPY_STALE_MS` after it started
 * must have died, so it's taken back and a retry starts again; the dialog
 * waits `COPY_REQUEST_TIMEOUT_MS`, past the route's limit, so it hears the
 * route's own answer (or the platform's 504) rather than giving up first.
 */
export const COPY_IMAGES_BUDGET_MS = 20_000;
export const COPY_STALE_MS = 45_000;
export const COPY_REQUEST_TIMEOUT_MS = 45_000;

/** Answered to a retry while the first attempt is still making the list. */
export const COPY_IN_PROGRESS_ERROR = 'This list is still being made. Try again in a moment.';

/** Sent back with the new list when some images weren't copied for lack of upload space. */
export const COPY_LIST_IMAGES_QUOTA_NOTICE =
  'Some images weren’t copied: your upload space is full. You can add them by editing.';

/** Sent back with the new list when some images couldn't be copied for any other reason. */
export const COPY_LIST_IMAGES_FAILED_NOTICE =
  'Some images couldn’t be copied. You can add them by editing.';

/** A row of `GET /api/wishlists/[id]/members`, as the people step reads it. */
export interface SourcePerson {
  user: { _id: string; username?: string | null; image?: string | null };
  role: 'owner' | 'member';
}

/** Someone the people step offers to invite to the new list, with their old role. */
export interface ReinviteCandidate {
  userId: string;
  username: string;
  image: string | null;
  role: 'owner' | 'member';
}

/**
 * Who the new list's owner is offered to invite: the source list's other
 * co-owners and its members, each with the role they hold there. Not the
 * starter (they own the new list already), and not anyone without a username,
 * since invites go by username.
 */
export function reinviteCandidates(people: SourcePerson[], selfId: string): ReinviteCandidate[] {
  const seen = new Set<string>([selfId]);
  const out: ReinviteCandidate[] = [];
  for (const { user, role } of people) {
    if (seen.has(user._id) || !user.username) continue;
    seen.add(user._id);
    out.push({ userId: user._id, username: user.username, image: user.image ?? null, role });
  }
  return out;
}
