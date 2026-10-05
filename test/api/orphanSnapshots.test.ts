import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectTestDB, disconnectTestDB, clearTestDB } from '../db';

// The orphaned-snapshot report (WIS-104) lists `snapshots/` and names the blobs
// no reservation or gift log holds, past a grace period. It must never delete.

vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
const list = vi.fn();
const del = vi.fn();
vi.mock('@vercel/blob', () => ({
  list: (...a: unknown[]) => list(...a),
  del: (...a: unknown[]) => del(...a),
  copy: vi.fn(),
  head: vi.fn(),
  put: vi.fn(),
}));

import { POST } from '@/app/api/maintenance/orphan-snapshots/route';
import { findOrphanSnapshots, SNAPSHOT_ORPHAN_GRACE_MS } from '@/lib/utils/orphanSnapshots';
import { Types } from 'mongoose';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

const TOKEN = ['vercel', 'blob', 'rw', 'TestStore42', 'notasecret'].join('_');
const HOST = 'https://teststore42.public.blob.vercel-storage.com';
const NOW = new Date('2026-10-05T12:00:00Z');
const OLD = new Date(NOW.getTime() - SNAPSHOT_ORPHAN_GRACE_MS - 1000);
const FRESH = new Date(NOW.getTime() - 60 * 1000);

const blob = (pathname: string, uploadedAt = OLD, size = 100) => ({
  url: `${HOST}/${pathname}`,
  pathname,
  size,
  uploadedAt,
});

// Holders only need their required fields: the report reads nothing but `itemImage`.
const ids = { gifter: new Types.ObjectId(), owner: new Types.ObjectId() };
const names = { itemName: 'Lamp', wishlistName: 'Birthday' };

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

beforeEach(async () => {
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN);
  vi.stubEnv('MIGRATION_SECRET', 'right-secret');
  await clearTestDB();
  list.mockReset();
  del.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const reserve = (itemImage: string) =>
  Reservation.create({
    ...ids,
    ...names,
    wishlist: new Types.ObjectId(),
    item: new Types.ObjectId(),
    itemImage,
  });
const logGift = (itemImage: string) =>
  GiftLog.create({ ...ids, ...names, giftedAt: NOW, itemImage });

describe('findOrphanSnapshots', () => {
  it('reports only old snapshots no reservation or gift log holds, and deletes nothing', async () => {
    const reserved = blob('snapshots/aaa.jpg');
    const gifted = blob('snapshots/bbb.jpg');
    const orphan = blob('snapshots/ccc.jpg', OLD, 250);
    const fresh = blob('snapshots/ddd.jpg', FRESH); // a booking may still be swapping it in
    list.mockResolvedValue({ blobs: [reserved, gifted, orphan, fresh], hasMore: false });
    await reserve(reserved.url);
    await logGift(gifted.url);

    const report = await findOrphanSnapshots({ now: NOW });

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: 'snapshots/' }));
    expect(report).toEqual({
      scanned: 4,
      scannedBytes: 550,
      inGracePeriod: 1,
      referenced: 2,
      orphans: [{ pathname: 'snapshots/ccc.jpg', size: 250, uploadedAt: OLD.toISOString() }],
      orphanBytes: 250,
    });
    expect(del).not.toHaveBeenCalled();
  });

  it('ignores anything not directly inside snapshots/', async () => {
    list.mockResolvedValue({
      blobs: [blob('snapshots/nested/x.jpg'), blob('snapshots/ok.jpg')],
      hasMore: false,
    });
    const report = await findOrphanSnapshots({ now: NOW });
    expect(report.scanned).toBe(1);
    expect(report.orphans.map((o) => o.pathname)).toEqual(['snapshots/ok.jpg']);
  });

  it('follows the listing cursor across pages', async () => {
    list
      .mockResolvedValueOnce({ blobs: [blob('snapshots/p1.jpg')], cursor: 'next', hasMore: true })
      .mockResolvedValueOnce({ blobs: [blob('snapshots/p2.jpg')], hasMore: false });
    await reserve(`${HOST}/snapshots/p2.jpg`);

    const report = await findOrphanSnapshots({ now: NOW });

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0]).toMatchObject({ cursor: 'next' });
    expect(report.scanned).toBe(2);
    expect(report.orphans.map((o) => o.pathname)).toEqual(['snapshots/p1.jpg']);
  });

  it('reports nothing and lists nothing without our own store', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    const report = await findOrphanSnapshots({ now: NOW });
    expect(list).not.toHaveBeenCalled();
    expect(report.scanned).toBe(0);
    expect(report.orphans).toEqual([]);
  });

  it('throws on a failed listing rather than reporting a partial scan', async () => {
    list.mockRejectedValue(new Error('store down'));
    await expect(findOrphanSnapshots({ now: NOW })).rejects.toThrow('store down');
  });
});

describe('POST /api/maintenance/orphan-snapshots', () => {
  const post = (secret?: string) =>
    new NextRequest('http://localhost/api/maintenance/orphan-snapshots', {
      method: 'POST',
      headers: secret ? { 'X-Migration-Secret': secret } : {},
    });

  it('401s without the operator secret and never lists the store', async () => {
    expect((await POST(post())).status).toBe(401);
    expect((await POST(post('wrong-secret'))).status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('returns the report with the secret', async () => {
    // The route judges age by the real clock.
    const longAgo = new Date('2020-01-01T00:00:00Z');
    list.mockResolvedValue({ blobs: [blob('snapshots/zzz.png', longAgo)], hasMore: false });
    const res = await POST(post('right-secret'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true, scanned: 1, orphanBytes: 100 });
    expect(body.orphans).toEqual([expect.objectContaining({ pathname: 'snapshots/zzz.png' })]);
    expect(del).not.toHaveBeenCalled();
  });
});
