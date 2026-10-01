import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@vercel/blob', () => ({ del: vi.fn(), list: vi.fn(), put: vi.fn() }));

import { auth } from '@/lib/auth';
import { DELETE } from '@/app/api/wishlists/[id]/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import Notification from '@/models/Notification';

const session = vi.mocked(auth);

interface PlanStage {
  stage?: string;
  indexName?: string;
  inputStage?: PlanStage;
  inputStages?: PlanStage[];
  // SBE explains wrap the classic plan tree in `queryPlan`.
  queryPlan?: PlanStage;
}
type Explained = { queryPlanner: { winningPlan: PlanStage } };

/** Every stage of a winning plan, outermost first: `STAGE` or `STAGE:indexName`. */
function planStages(plan: PlanStage | undefined): string[] {
  if (!plan) return [];
  const here = plan.stage ? [plan.indexName ? `${plan.stage}:${plan.indexName}` : plan.stage] : [];
  const children = [plan.queryPlan, plan.inputStage, ...(plan.inputStages ?? [])];
  return [...here, ...children.flatMap(planStages)];
}

async function wishlistIndex() {
  const indexes = await Notification.collection.indexes();
  return indexes.find((i) => i.key.wishlist === 1 && Object.keys(i.key).length === 1);
}

let ownerId: string;
let doomedId: string;

beforeAll(async () => {
  await connectTestDB();
  // Mongoose's autoIndex build: what a deploy runs on its first connection.
  await Notification.init();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  session.mockReset();
  const owner = await User.create({ email: 'owner@x.com', username: 'owner' });
  const friend = await User.create({ email: 'friend@x.com', username: 'friend' });
  ownerId = owner._id.toString();
  const doomed = await Wishlist.create({
    name: 'Doomed',
    owners: [ownerId],
    visibility: 'everyone',
    slug: 'doomed',
  });
  doomedId = doomed._id.toString();
  // Two that point at a list, two that don't (and so store `wishlist: null`).
  await Notification.create([
    { user: friend._id, type: 'wishlist_invite', wishlist: doomedId, wishlistName: 'Doomed' },
    { user: friend._id, type: 'proposal_approved', wishlist: new mongoose.Types.ObjectId() },
    { user: ownerId, type: 'follow', actorUsername: 'friend' },
    { user: friend._id, type: 'follow', actorUsername: 'owner' },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Notification wishlist index', () => {
  it('is built by autoIndex as a partial index', async () => {
    const index = await wishlistIndex();
    expect(index).toBeDefined();
    expect(index?.partialFilterExpression).toBeDefined();
  });

  it('leaves out the notifications that carry no wishlist', async () => {
    const index = await wishlistIndex();
    const { keysPerIndex } = await mongoose.connection.db!.command({
      validate: Notification.collection.collectionName,
    });
    expect(await Notification.countDocuments()).toBe(4);
    // A `$exists: true` filter would index all four: the follows store null.
    expect(keysPerIndex[index!.name!]).toBe(2);
  });

  // regression: Notification had no index on `wishlist`, so the cleanup in
  // DELETE /api/wishlists/[id] (`Notification.deleteMany({ wishlist: id })`)
  // was a full scan of the notifications collection.
  it('regression: serves the wishlist-delete cleanup with an index scan, not a collection scan', async () => {
    const deleteMany = vi.spyOn(Notification, 'deleteMany');
    session.mockResolvedValue({ user: { id: ownerId } } as never);
    const res = await DELETE(
      new NextRequest(`http://localhost/api/wishlists/${doomedId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: doomedId }) }
    );
    expect(res.status).toBe(200);

    // Explain the very filter the route sent, so a change to it is caught too.
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const [filter] = deleteMany.mock.calls[0];
    const explain = Notification.deleteMany(filter).explain('queryPlanner');
    const { queryPlanner } = (await explain) as unknown as Explained;
    const stages = planStages(queryPlanner.winningPlan);
    const index = await wishlistIndex();
    expect(stages).toContain(`IXSCAN:${index!.name}`);
    expect(stages).not.toContain('COLLSCAN');
  });
});
