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
import { GET as CRON } from '@/app/api/cron/sweep-snapshots/route';
import {
  findOrphanSnapshots,
  sweepOrphanSnapshots,
  SNAPSHOT_ORPHAN_GRACE_MS,
} from '@/lib/utils/orphanSnapshots';
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
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  vi.restoreAllMocks();
  await clearTestDB();
  list.mockReset();
  del.mockReset();
  del.mockResolvedValue(undefined);
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
      orphans: [
        {
          url: orphan.url,
          pathname: 'snapshots/ccc.jpg',
          size: 250,
          uploadedAt: OLD.toISOString(),
        },
      ],
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

describe('sweepOrphanSnapshots', () => {
  const sweep = (opts: Parameters<typeof sweepOrphanSnapshots>[0] = {}) =>
    sweepOrphanSnapshots({ now: NOW, recheckDelayMs: 0, ...opts });

  it('deletes only old, unheld snapshots', async () => {
    const held = blob('snapshots/held.jpg');
    const orphan = blob('snapshots/orphan.jpg', OLD, 300);
    const fresh = blob('snapshots/fresh.jpg', FRESH);
    list.mockResolvedValue({ blobs: [held, orphan, fresh], hasMore: false });
    await reserve(held.url);

    const result = await sweep();

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith([orphan.url]);
    expect(result).toEqual({
      scanned: 3,
      orphansFound: 1,
      keptNowHeld: 0,
      deleted: 1,
      deletedBytes: 300,
      deleteFailed: 0,
      leftForNextRun: 0,
    });
  });

  // regression: marking a gift deletes the reservation before writing the gift
  // log that takes its snapshot over; a scan in that gap sees a held snapshot as
  // unheld. The second check, after the delay, must keep it.
  it('keeps a snapshot a gift log takes over between the scan and the re-check', async () => {
    const handedOn = blob('snapshots/handed-on.jpg');
    list.mockResolvedValue({ blobs: [handedOn], hasMore: false });
    const distinct = GiftLog.distinct.bind(GiftLog);
    let calls = 0;
    vi.spyOn(GiftLog, 'distinct').mockImplementation(((...args: Parameters<typeof distinct>) => {
      calls++;
      // The gift log lands after the first scan, before the re-check.
      if (calls === 2) return logGift(handedOn.url).then(() => distinct(...args));
      return distinct(...args);
    }) as never);

    const result = await sweep();

    expect(del).not.toHaveBeenCalled();
    expect(result).toMatchObject({ orphansFound: 1, keptNowHeld: 1, deleted: 0 });
  });

  it('deletes at most maxDeletions and leaves the rest for the next run', async () => {
    list.mockResolvedValue({
      blobs: [blob('snapshots/1.jpg'), blob('snapshots/2.jpg'), blob('snapshots/3.jpg')],
      hasMore: false,
    });
    const result = await sweep({ maxDeletions: 2 });
    expect(del).toHaveBeenCalledWith([`${HOST}/snapshots/1.jpg`, `${HOST}/snapshots/2.jpg`]);
    expect(result).toMatchObject({ deleted: 2, leftForNextRun: 1 });
  });

  it('counts a failed delete instead of throwing', async () => {
    list.mockResolvedValue({ blobs: [blob('snapshots/x.jpg')], hasMore: false });
    del.mockRejectedValue(new Error('store down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await sweep();
    expect(result).toMatchObject({ deleted: 0, deleteFailed: 1 });
  });

  it('deletes nothing when the listing fails', async () => {
    list.mockRejectedValue(new Error('store down'));
    await expect(sweep()).rejects.toThrow('store down');
    expect(del).not.toHaveBeenCalled();
  });
});

describe('GET /api/cron/sweep-snapshots', () => {
  const get = (authorization?: string) =>
    new NextRequest('http://localhost/api/cron/sweep-snapshots', {
      headers: authorization ? { authorization } : {},
    });

  it('500s and sweeps nothing when CRON_SECRET is not set', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await CRON(get('Bearer '))).status).toBe(500);
    expect(list).not.toHaveBeenCalled();
  });

  it('401s without the right bearer token', async () => {
    expect((await CRON(get())).status).toBe(401);
    expect((await CRON(get('Bearer wrong'))).status).toBe(401);
    expect((await CRON(get('cron-secret'))).status).toBe(401);
    expect(list).not.toHaveBeenCalled();
  });

  it('sweeps with the bearer token Vercel Cron sends', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      // The route judges age by the real clock.
      const orphan = blob('snapshots/old.jpg', new Date('2020-01-01T00:00:00Z'));
      list.mockResolvedValue({ blobs: [orphan], hasMore: false });
      const pending = CRON(get('Bearer cron-secret'));
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1));
      await vi.runAllTimersAsync();
      const res = await pending;
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, deleted: 1 });
      expect(del).toHaveBeenCalledWith([orphan.url]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('500s, without detail, when the sweep fails', async () => {
    list.mockRejectedValue(new Error('store down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await CRON(get('Bearer cron-secret'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Sweep failed' });
  });
});
