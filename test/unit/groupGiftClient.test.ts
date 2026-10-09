import { describe, it, expect } from 'vitest';
import type { ApiItem } from '@/types/api';
import {
  applyGroupGiftAction,
  groupGiftRequest,
  withServerGroupGift,
} from '@/lib/utils/groupGiftClient';
import { cardMenuActions, type CardActionContext } from '@/lib/utils/itemCardActions';
import { isDimmedInAll, countListChips } from '@/lib/utils/listChips';

const ME = 'me';
const base = (o: Partial<ApiItem> = {}) =>
  ({
    _id: 'i1',
    wishlist: 'w',
    name: 'Bike',
    status: 'available',
    price: { value: 30000, currency: 'USD' },
    ...o,
  }) as ApiItem;

const inGift = (organizer: boolean, alone = false): ApiItem =>
  base({
    status: 'booked',
    bookedBy: organizer ? ME : undefined,
    groupGift: {
      contributing: true,
      organizer,
      status: 'open',
      target: { value: 30000, currency: 'USD' },
      pledgedTotal: alone ? 5000 : 12000,
      percentFunded: alone ? 16 : 40,
      contributors: [
        ...(alone ? [] : [{ name: 'Ann', pledged: 7000, organizer: !organizer, you: false }]),
        { name: 'Me', pledged: 5000, organizer, you: true },
      ],
    },
  });

describe('groupGiftRequest', () => {
  it('maps each action to its route', () => {
    expect(groupGiftRequest('i1', { type: 'start', pledged: 5 })).toMatchObject({
      method: 'POST',
      url: '/api/items/i1/group-gift',
      body: { pledged: 5 },
      idempotent: true,
    });
    expect(groupGiftRequest('i1', { type: 'join', pledged: 5 })).toMatchObject({
      method: 'PUT',
      url: '/api/items/i1/group-gift/me',
    });
    expect(groupGiftRequest('i1', { type: 'leave' })).toMatchObject({
      method: 'DELETE',
      url: '/api/items/i1/group-gift/me',
    });
    expect(groupGiftRequest('i1', { type: 'give' }).url).toBe('/api/items/i1/group-gift/given');
    expect(groupGiftRequest('i1', { type: 'cancel' }).url).toBe('/api/items/i1/group-gift/cancel');
    expect(groupGiftRequest('i1', { type: 'convert' }).url).toBe(
      '/api/items/i1/group-gift/convert'
    );
  });

  it('sends a target only when given', () => {
    const body = (a: Parameters<typeof groupGiftRequest>[1]) =>
      groupGiftRequest('i1', a).body as Record<string, unknown>;
    expect(body({ type: 'start', pledged: 5 })).not.toHaveProperty('target');
    expect(
      body({ type: 'start', pledged: 5, target: { value: 9, currency: 'EUR' } })
    ).toHaveProperty('target');
  });
});

describe('applyGroupGiftAction', () => {
  it('start books the item for the viewer as organizer, at the item price', () => {
    const out = applyGroupGiftAction(base(), { type: 'start', pledged: 5000 }, ME);
    expect(out).toMatchObject({ status: 'booked', bookedBy: ME });
    expect(out.groupGift).toMatchObject({
      contributing: true,
      organizer: true,
      percentFunded: 16,
      target: { value: 30000, currency: 'USD' },
    });
  });

  it('start with no price and no target changes nothing', () => {
    const item = base({ price: undefined });
    expect(applyGroupGiftAction(item, { type: 'start', pledged: 5 }, ME)).toBe(item);
  });

  it('a pledge change updates the total, the percent and the funded state', () => {
    const out = applyGroupGiftAction(inGift(false), { type: 'pledge', pledged: 23000 }, ME);
    expect(out.groupGift).toMatchObject({
      pledgedTotal: 30000,
      percentFunded: 100,
      status: 'funded',
    });
  });

  it('leaving as the last contributor releases the item', () => {
    const out = applyGroupGiftAction(inGift(true, true), { type: 'leave' }, ME);
    expect(out).toMatchObject({ status: 'available', bookedBy: null, groupGift: undefined });
  });

  it('leaving with others left shows only the percent they fund', () => {
    const out = applyGroupGiftAction(inGift(true), { type: 'leave' }, ME);
    expect(out.status).toBe('booked');
    expect(out.bookedBy).toBeNull();
    expect(out.groupGift).toEqual({ contributing: false, percentFunded: 23 });
  });

  it('cancel releases; convert keeps the viewer’s booking; give marks it given', () => {
    expect(applyGroupGiftAction(inGift(true), { type: 'cancel' }, ME)).toMatchObject({
      status: 'available',
      bookedBy: null,
      groupGift: undefined,
    });
    expect(applyGroupGiftAction(inGift(true), { type: 'convert' }, ME)).toMatchObject({
      status: 'booked',
      bookedBy: ME,
      groupGift: undefined,
    });
    expect(applyGroupGiftAction(inGift(true), { type: 'give' }, ME)).toMatchObject({
      givenByMe: true,
      groupGift: undefined,
    });
  });
});

describe('withServerGroupGift', () => {
  // regression: a merge keeps what an answer leaves out, so a cancelled gift's
  // summary (absent from the answer) would otherwise stay on the card.
  it('clears what the answer no longer carries', () => {
    const answer = withServerGroupGift(base());
    const merged = { ...inGift(true), ...answer };
    expect(merged.groupGift).toBeUndefined();
    expect(merged.bookedBy).toBeNull();
  });

  it('keeps what it does carry', () => {
    expect(withServerGroupGift(inGift(true)).groupGift?.contributing).toBe(true);
  });
});

describe('group gift card actions', () => {
  const ctx = (o: Partial<CardActionContext>): CardActionContext => ({
    isAuthenticated: true,
    isOwner: false,
    isMember: true,
    status: 'available',
    isCompleted: false,
    isGivenByViewer: false,
    hasLink: false,
    canEdit: false,
    canSave: false,
    canDelete: false,
    canAddLink: false,
    ...o,
  });

  it('offers starting on an available item', () => {
    expect(cardMenuActions(ctx({ canStartGroupGift: true }))).toEqual(['startGroupGift']);
  });

  it('gives the organizer the endings, with Cancel last, and a contributor only Leave', () => {
    expect(cardMenuActions(ctx({ status: 'booked', groupGiftRole: 'organizer' }))).toEqual([
      'giveGroupGift',
      'convertGroupGift',
      'leaveGroupGift',
      'cancelGroupGift',
    ]);
    expect(cardMenuActions(ctx({ status: 'booked', groupGiftRole: 'contributor' }))).toEqual([
      'leaveGroupGift',
    ]);
  });

  it('never offers an owner any of it', () => {
    expect(
      cardMenuActions(
        ctx({ isOwner: true, isMember: false, canStartGroupGift: true, groupGiftRole: 'organizer' })
      )
    ).not.toContain('startGroupGift');
  });
});

describe('list chips and group gifts', () => {
  const contributorItem = { ...inGift(false) };
  it('counts a contributor’s group gift under Reserved by you, though they are not bookedBy', () => {
    const counts = countListChips([contributorItem], 'member', ME);
    expect(counts['reserved-by-you']).toBe(1);
  });

  it('does not dim a group gift that someone else started, which can be joined', () => {
    const other = base({
      status: 'booked',
      groupGift: { contributing: false, percentFunded: 10 },
    });
    expect(isDimmedInAll(other, 'member', ME)).toBe(false);
    expect(isDimmedInAll({ ...other, groupGift: undefined, bookedBy: 'x' }, 'member', ME)).toBe(
      true
    );
  });
});
