import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Types } from 'mongoose';
import { OWNER_STATUS_ERROR, planItemUpdate, type ItemActor } from '@/lib/utils/itemUpdatePlan';
import { FOREIGN_IMAGE_ERROR } from '@/lib/utils/blob';
import { GROUP_GIFT_UNBOOK_ERROR } from '@/lib/utils/groupGifts';
import { PROPOSAL_REVIEWED_ERROR } from '@/lib/utils/proposalReview';

// The role rules of an item edit (WIS-373): who may change what, and the guard
// each write is made under. No database: `planItemUpdate` only decides.

const userId = new Types.ObjectId().toString();
const otherId = new Types.ObjectId().toString();
const owner: ItemActor = { userId, isOwner: true, isProposer: false };
const member: ItemActor = { userId, isOwner: false, isProposer: false };
const proposer: ItemActor = { userId, isOwner: false, isProposer: true };

type PlanItem = Parameters<typeof planItemUpdate>[0];
const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  status: 'available',
  bookedBy: null,
  proposedBy: null,
  groupGift: null,
  imageUrl: null,
  ...over,
});

const HOST = 'https://teststore42.public.blob.vercel-storage.com';

function expectPlan(result: ReturnType<typeof planItemUpdate>) {
  if (!result.ok) throw new Error(`refused: ${result.error}`);
  return result;
}

describe('planItemUpdate: owners on a live item', () => {
  it('sets content fields only, never status or bookedBy, on a booked item too', () => {
    const plan = expectPlan(
      planItemUpdate(
        item({ status: 'booked', bookedBy: new Types.ObjectId(otherId) }),
        {
          name: 'New',
          price: { value: 1250, currency: 'eur' },
          link: null,
          notes: 'n',
          mostWanted: true,
        },
        owner
      )
    );
    expect(plan.updateData).toEqual({
      name: 'New',
      price: { value: 1250, currency: 'EUR' },
      link: null,
      notes: 'n',
      mostWanted: true,
    });
    expect(plan.updateData).not.toHaveProperty('status');
    expect(plan.updateData).not.toHaveProperty('bookedBy');
    expect(plan.bookingGuard).toBeNull();
    expect(plan.proposalGuard).toBeNull();
    expect(plan.publishesLiveItem).toBe(false);
    expect(plan.reservationAction).toBeNull();
  });

  it('refuses an owner reserving, with the same answer whatever the item is', () => {
    for (const status of ['available', 'booked'] as const) {
      const result = planItemUpdate(item({ status }), { status: 'booked' }, owner);
      expect(result).toEqual({ ok: false, status: 400, error: OWNER_STATUS_ERROR });
    }
  });

  it('publish clears the booker but is guarded as a live-item publish', () => {
    const plan = expectPlan(
      planItemUpdate(item({ status: 'draft' }), { status: 'available' }, owner)
    );
    expect(plan.updateData).toEqual({ status: 'available', bookedBy: null });
    expect(plan.publishesLiveItem).toBe(true);
    expect(plan.endsGroupGift).toBe(false);
  });

  it('draft and received end a group gift and are not publishes', () => {
    for (const status of ['draft', 'completed'] as const) {
      const plan = expectPlan(planItemUpdate(item(), { status }, owner));
      expect(plan.updateData).toEqual({ status, bookedBy: null });
      expect(plan.endsGroupGift).toBe(true);
      expect(plan.publishesLiveItem).toBe(false);
    }
  });
});

describe('planItemUpdate: proposals', () => {
  const proposal = () => item({ status: 'proposed', proposedBy: new Types.ObjectId(otherId) });

  it("an owner's approval clears proposedBy and bookedBy, is guarded, and names the proposer", () => {
    const plan = expectPlan(planItemUpdate(proposal(), { status: 'available' }, owner));
    expect(plan.updateData).toEqual({ status: 'available', proposedBy: null, bookedBy: null });
    expect(plan.proposalGuard).toEqual({
      filter: { status: 'proposed' },
      conflict: PROPOSAL_REVIEWED_ERROR,
    });
    expect(plan.approvedProposer?.toString()).toBe(otherId);
  });

  it("an owner's edit of a proposal without a status leaves its status alone", () => {
    const plan = expectPlan(planItemUpdate(proposal(), { name: 'Better' }, owner));
    expect(plan.updateData).toEqual({ name: 'Better' });
    expect(plan.approvedProposer).toBeNull();
    expect(plan.proposalGuard).toBeNull();
  });

  it('refuses an owner moving a proposal anywhere but draft or available', () => {
    const result = planItemUpdate(proposal(), { status: 'completed' }, owner);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("a proposer's edit ignores mostWanted and is guarded on it still being theirs", () => {
    const plan = expectPlan(
      planItemUpdate(proposal(), { name: 'Mine', mostWanted: true }, proposer)
    );
    expect(plan.updateData).toEqual({ name: 'Mine' });
    expect(plan.proposalGuard?.filter).toEqual({ status: 'proposed', proposedBy: userId });
  });

  it('refuses a proposer changing their proposal’s status', () => {
    const result = planItemUpdate(proposal(), { status: 'available' }, proposer);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it('refuses a member who is neither owner nor proposer', () => {
    const result = planItemUpdate(proposal(), { name: 'x' }, member);
    expect(result).toMatchObject({ ok: false, status: 403 });
  });
});

describe('planItemUpdate: members', () => {
  it('reserving an available item books it to them, guarded on it still being available', () => {
    const plan = expectPlan(planItemUpdate(item(), { status: 'booked' }, member));
    expect(plan.updateData.status).toBe('booked');
    expect(plan.updateData.bookedBy?.toString()).toBe(userId);
    expect(plan.reservationAction).toBe('create');
    expect(plan.bookingGuard?.filter).toEqual({ status: 'available' });
  });

  it('releasing is guarded on it still being their booking and no group gift', () => {
    const plan = expectPlan(
      planItemUpdate(
        item({ status: 'booked', bookedBy: new Types.ObjectId(userId) }),
        { status: 'available' },
        member
      )
    );
    expect(plan.updateData).toEqual({ status: 'available', bookedBy: null });
    expect(plan.reservationAction).toBe('delete');
    expect(plan.bookingGuard?.filter).toEqual({
      status: 'booked',
      bookedBy: userId,
      groupGift: null,
    });
  });

  it("refuses releasing someone else's booking", () => {
    const result = planItemUpdate(
      item({ status: 'booked', bookedBy: new Types.ObjectId(otherId) }),
      { status: 'available' },
      member
    );
    expect(result).toEqual({
      ok: false,
      status: 403,
      error: 'You can only release items you have reserved',
    });
  });

  it("refuses releasing a group gift's item through the solo release", () => {
    const result = planItemUpdate(
      item({
        status: 'booked',
        bookedBy: new Types.ObjectId(userId),
        groupGift: new Types.ObjectId(),
      }),
      { status: 'available' },
      member
    );
    expect(result).toEqual({ ok: false, status: 409, error: GROUP_GIFT_UNBOOK_ERROR });
  });

  it('refuses reserving an item that is not available, and any content edit', () => {
    expect(planItemUpdate(item({ status: 'draft' }), { status: 'booked' }, member)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(planItemUpdate(item(), { name: 'Hijack' }, member)).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe('planItemUpdate: images', () => {
  // A fake token in the SDK's `vercel_blob_rw_<storeId>_<secret>` shape; our
  // store's public host (HOST) is derived from it.
  beforeEach(() => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', ['vercel', 'blob', 'rw', 'TestStore42', 'x'].join('_'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses another user's upload", () => {
    const result = planItemUpdate(item(), { imageUrl: `${HOST}/uploads/${otherId}/x.jpg` }, owner);
    expect(result).toEqual({ ok: false, status: 400, error: FOREIGN_IMAGE_ERROR });
  });

  it("drops an unchanged image, even someone else's, so it isn't written back", () => {
    const current = `${HOST}/uploads/${otherId}/x.jpg`;
    const plan = expectPlan(
      planItemUpdate(item({ imageUrl: current }), { imageUrl: current, name: 'n' }, owner)
    );
    expect(plan.updateData).toEqual({ name: 'n' });
  });
});
