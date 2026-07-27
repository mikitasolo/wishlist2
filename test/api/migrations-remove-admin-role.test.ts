import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));

import { POST } from '@/app/api/migrations/remove-admin-role/route';
import User from '@/models/User';
import Wishlist from '@/models/Wishlist';
import WishlistMember from '@/models/WishlistMember';
import WishlistInvite from '@/models/WishlistInvite';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';

function run() {
  return POST(
    new NextRequest('http://localhost/api/migrations/remove-admin-role', {
      method: 'POST',
      headers: { 'X-Migration-Secret': process.env.MIGRATION_SECRET! },
    })
  );
}

/** `role` is gone from the schema, so an admin row has to be inserted raw. */
async function insertAdmin(wishlist: mongoose.Types.ObjectId, user: mongoose.Types.ObjectId) {
  await mongoose.connection.collection('wishlistmembers').insertOne({
    wishlist,
    user,
    role: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

let owner: mongoose.Types.ObjectId;
let admin: mongoose.Types.ObjectId;
let wid: mongoose.Types.ObjectId;

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  await clearTestDB();
  owner = (await User.create({ email: 'o@x.com', username: 'owner' }))._id;
  admin = (await User.create({ email: 'a@x.com', username: 'admin_user' }))._id;
  const wl = await Wishlist.create({ name: 'List', owners: [owner], visibility: 'everyone' });
  wid = wl._id;
});

describe('POST /api/migrations/remove-admin-role', () => {
  it('promotes an admin to co-owner and drops their membership row', async () => {
    await insertAdmin(wid, admin);

    const res = await run();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, adminsFound: 1, promoted: 1 });

    const wl = await Wishlist.findById(wid);
    expect(wl!.owners.map(String)).toEqual([owner.toString(), admin.toString()]);
    // Owners live only in `owners`, never as a membership row.
    expect(await WishlistMember.findOne({ wishlist: wid, user: admin })).toBeNull();
  });

  // Owners are booking-blind, so a booking the new owner held would be stranded:
  // invisible to them, hidden from the other owners, unbookable by anyone.
  it('releases the bookings and reservations the admin held on that list', async () => {
    await insertAdmin(wid, admin);
    const item = await Item.create({
      wishlist: wid,
      name: 'Gift',
      status: 'booked',
      bookedBy: admin,
    });
    await Reservation.create({
      gifter: admin,
      wishlist: wid,
      item: item._id,
      owner,
      itemName: 'Gift',
      wishlistName: 'List',
    });

    const res = await run();
    expect(await res.json()).toMatchObject({ unbookedItems: 1, cancelledReservations: 1 });

    const fresh = await Item.findById(item._id);
    expect(fresh?.status).toBe('available');
    expect(fresh?.bookedBy).toBeNull();
    expect(await Reservation.findOne({ gifter: admin })).toBeNull();
  });

  it('converts pending admin invites to owner invites', async () => {
    const invitee = await User.create({ email: 'i@x.com', username: 'invitee' });
    await mongoose.connection.collection('wishlistinvites').insertOne({
      wishlist: wid,
      invitedBy: owner,
      invitedUser: invitee._id,
      role: 'admin',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await run();
    expect(await res.json()).toMatchObject({ pendingInvitesConverted: 1 });

    const inv = await WishlistInvite.findOne({ invitedUser: invitee._id });
    // Same intent ("help me run this list") and they still have to accept, so
    // nothing is granted behind their back.
    expect(inv?.role).toBe('owner');
    expect(inv?.status).toBe('pending');
  });

  it('clears the now-meaningless role field from plain members', async () => {
    const member = await User.create({ email: 'm@x.com', username: 'plain' });
    await mongoose.connection.collection('wishlistmembers').insertOne({
      wishlist: wid,
      user: member._id,
      role: 'member',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await run();
    expect(await res.json()).toMatchObject({ memberRoleFieldsCleared: 1 });

    const raw = await mongoose.connection
      .collection('wishlistmembers')
      .findOne({ user: member._id });
    expect(raw!.role).toBeUndefined();
    // Still a member — only the role field went away.
    expect(await WishlistMember.findOne({ wishlist: wid, user: member._id })).not.toBeNull();
  });

  it('drops an admin row whose wishlist no longer exists', async () => {
    await insertAdmin(new mongoose.Types.ObjectId(), admin);

    const res = await run();
    expect(await res.json()).toMatchObject({ promoted: 0, orphanedMembershipsRemoved: 1 });
    expect(await mongoose.connection.collection('wishlistmembers').countDocuments()).toBe(0);
  });

  it('backfills owners[] on a wishlist the co-ownership migration never reached', async () => {
    const legacy = await mongoose.connection.collection('wishlists').insertOne({
      name: 'Legacy',
      owner,
      isPublic: true,
      visibility: 'everyone',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await insertAdmin(legacy.insertedId, admin);

    await run();

    const wl = await Wishlist.findById(legacy.insertedId);
    // The original owner must survive being joined by the promoted admin.
    expect(wl!.owners.map(String)).toEqual([owner.toString(), admin.toString()]);
  });

  it('is idempotent — a second run finds nothing to do', async () => {
    await insertAdmin(wid, admin);

    await run();
    const second = await run();
    expect(await second.json()).toMatchObject({
      adminsFound: 0,
      promoted: 0,
      pendingInvitesConverted: 0,
      memberRoleFieldsCleared: 0,
    });
  });

  it('401s without the migration secret', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/migrations/remove-admin-role', { method: 'POST' })
    );
    expect(res.status).toBe(401);
  });
});
