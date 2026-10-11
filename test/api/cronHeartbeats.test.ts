import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// Each cron's job is mocked: this file is about when the routes ping (WIS-382),
// not what the jobs do (their own tests cover that).
vi.mock('@/lib/mongodb', () => ({ default: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/utils/cronHeartbeat', () => ({ pingCronHeartbeat: vi.fn() }));
vi.mock('@/lib/utils/occasionReminders', () => ({ sendOccasionReminders: vi.fn() }));
vi.mock('@/lib/utils/orphanSnapshots', () => ({ sweepOrphanSnapshots: vi.fn() }));
vi.mock('@/lib/utils/birthdayCron', () => ({ runBirthdayTasks: vi.fn() }));
vi.mock('@/lib/utils/giftReminders', () => ({ sendGiftReminders: vi.fn() }));
vi.mock('@/lib/utils/bulkItemActions', () => ({ settleAllDeadMoves: vi.fn() }));

import { pingCronHeartbeat } from '@/lib/utils/cronHeartbeat';
import { sendOccasionReminders } from '@/lib/utils/occasionReminders';
import { sweepOrphanSnapshots } from '@/lib/utils/orphanSnapshots';
import { runBirthdayTasks } from '@/lib/utils/birthdayCron';
import { sendGiftReminders } from '@/lib/utils/giftReminders';
import { settleAllDeadMoves } from '@/lib/utils/bulkItemActions';
import { GET as OCCASIONS } from '@/app/api/cron/occasion-reminders/route';
import { GET as SWEEP } from '@/app/api/cron/sweep-snapshots/route';
import { GET as BIRTHDAYS } from '@/app/api/cron/birthdays/route';
import { GET as GIFTS } from '@/app/api/cron/gift-reminders/route';

const ping = vi.mocked(pingCronHeartbeat);
const occasions = vi.mocked(sendOccasionReminders);
const sweep = vi.mocked(sweepOrphanSnapshots);
const birthdays = vi.mocked(runBirthdayTasks);
const gifts = vi.mocked(sendGiftReminders);
const deadMoves = vi.mocked(settleAllDeadMoves);

function cronRequest(name: string, token = 'cron-secret') {
  return new NextRequest(`http://localhost/api/cron/${name}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

const giftRun = {
  reminders: { lists: 1, sent: 1, capped: false },
  nudges: { lists: 0, sent: 0, capped: false },
  emailed: 1,
};

beforeEach(() => {
  for (const fn of [ping, occasions, sweep, birthdays, gifts, deadMoves]) fn.mockReset();
  ping.mockResolvedValue(undefined);
  vi.stubEnv('CRON_SECRET', 'cron-secret');
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('cron heartbeats', () => {
  it('ping their own check with the run counts after a successful run', async () => {
    occasions.mockResolvedValue({ lists: 2, sent: 3, capped: false, emailed: 1 });
    expect((await OCCASIONS(cronRequest('occasion-reminders'))).status).toBe(200);
    expect(ping).toHaveBeenCalledWith('occasion-reminders', {
      lists: 2,
      sent: 3,
      capped: false,
      emailed: 1,
    });

    sweep.mockResolvedValue({
      scanned: 1,
      orphansFound: 0,
      keptNowHeld: 0,
      deleted: 0,
      deletedBytes: 0,
      deleteFailed: 0,
    } as Awaited<ReturnType<typeof sweepOrphanSnapshots>>);
    expect((await SWEEP(cronRequest('sweep-snapshots'))).status).toBe(200);
    expect(ping).toHaveBeenLastCalledWith(
      'sweep-snapshots',
      expect.objectContaining({ scanned: 1 })
    );

    birthdays.mockResolvedValue({ ok: true, results: { reminders: { sent: 1 } } });
    expect((await BIRTHDAYS(cronRequest('birthdays'))).status).toBe(200);
    expect(ping).toHaveBeenLastCalledWith('birthdays', { reminders: { sent: 1 } });

    deadMoves.mockResolvedValue({ settled: 0, failed: 0, capped: false });
    gifts.mockResolvedValue(giftRun);
    expect((await GIFTS(cronRequest('gift-reminders'))).status).toBe(200);
    expect(ping).toHaveBeenLastCalledWith('gift-reminders', {
      ...giftRun,
      deadMoves: { settled: 0, failed: 0, capped: false },
    });
    expect(ping).toHaveBeenCalledTimes(4);
  });

  it('never ping when the run is refused', async () => {
    expect((await OCCASIONS(cronRequest('occasion-reminders', 'wrong'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await BIRTHDAYS(cronRequest('birthdays'))).status).toBe(500);
    expect(ping).not.toHaveBeenCalled();
  });

  it('never ping when the run fails', async () => {
    occasions.mockRejectedValue(new Error('db down'));
    expect((await OCCASIONS(cronRequest('occasion-reminders'))).status).toBe(500);

    sweep.mockRejectedValue(new Error('blob down'));
    expect((await SWEEP(cronRequest('sweep-snapshots'))).status).toBe(500);

    // One birthday task failing fails the run, though the others ran.
    birthdays.mockResolvedValue({ ok: false, results: { reminders: { failed: true } } });
    expect((await BIRTHDAYS(cronRequest('birthdays'))).status).toBe(500);

    deadMoves.mockResolvedValue({ settled: 0, failed: 0, capped: false });
    gifts.mockRejectedValue(new Error('db down'));
    expect((await GIFTS(cronRequest('gift-reminders'))).status).toBe(500);

    expect(ping).not.toHaveBeenCalled();
  });

  it('gift reminders skip the ping when settling dead moves failed, though the reminders went', async () => {
    deadMoves.mockRejectedValue(new Error('db down'));
    gifts.mockResolvedValue(giftRun);
    const res = await GIFTS(cronRequest('gift-reminders'));
    expect(res.status).toBe(200);
    expect(gifts).toHaveBeenCalled();
    expect(ping).not.toHaveBeenCalled();
  });
});
