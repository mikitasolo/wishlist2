/**
 * What a member's item answer says about a live group gift (WIS-361), and the
 * pure arithmetic behind it. Only a member's answer ever carries one
 * (`serializeItem`); owners and anyone off the list get nothing, not even that
 * there is a gift.
 *
 *  - A contributor sees the target, every contributor's display name
 *    (`publicDisplayName`) and pledge, and which of them is the organizer and
 *    which is them. Never anyone's user id.
 *  - Any other member sees only how far it's funded, and the target's currency
 *    (so Join asks for a pledge in it), so the card can read "Group gift · N%
 *    funded · Join". No names, amounts or count.
 */

/** The most people one group gift can have. */
export const GROUP_GIFT_MAX_CONTRIBUTORS = 50;

/** The largest single pledge or target, in cents (10 million in any currency). */
export const GROUP_GIFT_MAX_CENTS = 1_000_000_000;

export interface GroupGiftContributorView {
  name: string;
  pledged: number;
  organizer: boolean;
  you: boolean;
}

export type GroupGiftSummary =
  | {
      /** The viewer is one of its contributors. */
      contributing: true;
      /** The viewer is its organizer: cancel, convert and mark as given are theirs. */
      organizer: boolean;
      status: 'open' | 'funded';
      target: { value: number; currency: string };
      /** All pledges together, in cents of the target's currency. */
      pledgedTotal: number;
      percentFunded: number;
      /** In join order. */
      contributors: GroupGiftContributorView[];
    }
  | {
      contributing: false;
      percentFunded: number;
      /** The currency a pledge is made in. Never an amount. */
      target: { currency: string };
    };

/** A live group gift as one of its contributors sees it. */
export type ContributingGroupGift = Extract<GroupGiftSummary, { contributing: true }>;

/** Whether pledges of `total` cents fund a target of `target` cents. */
export function isFunded(total: number, target: number): boolean {
  return total >= target;
}

/** Whole percent funded, rounded down and capped at 100 (a target of 0 or less counts as funded). */
export function percentFunded(total: number, target: number): number {
  if (target <= 0) return 100;
  return Math.min(100, Math.floor((Math.max(0, total) * 100) / target));
}

export interface GroupGiftSummarySource {
  organizer: string;
  target: { value: number; currency: string };
  contributors: ReadonlyArray<{ user: string; pledged: number }>;
}

/**
 * The summary `viewerId` (a member who isn't an owner) gets of a live gift.
 * `names` maps the contributors' ids to their display names; it's only read
 * for a contributor's view.
 */
export function summarizeGroupGift(
  gift: GroupGiftSummarySource,
  viewerId: string,
  names: ReadonlyMap<string, string>
): GroupGiftSummary {
  const total = gift.contributors.reduce((sum, c) => sum + c.pledged, 0);
  const percent = percentFunded(total, gift.target.value);
  if (!gift.contributors.some((c) => c.user === viewerId)) {
    return {
      contributing: false,
      percentFunded: percent,
      target: { currency: gift.target.currency },
    };
  }
  return {
    contributing: true,
    organizer: gift.organizer === viewerId,
    status: isFunded(total, gift.target.value) ? 'funded' : 'open',
    target: { value: gift.target.value, currency: gift.target.currency },
    pledgedTotal: total,
    percentFunded: percent,
    contributors: gift.contributors.map((c) => ({
      name: names.get(c.user) ?? 'Someone',
      pledged: c.pledged,
      organizer: c.user === gift.organizer,
      you: c.user === viewerId,
    })),
  };
}
