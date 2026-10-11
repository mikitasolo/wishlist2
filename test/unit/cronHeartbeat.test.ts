import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { countsOnly, pingCronHeartbeat, HEARTBEAT_TIMEOUT_MS } from '@/lib/utils/cronHeartbeat';
import { CRON_HEARTBEAT_ENV_VARS, getCronHeartbeatUrl } from '@/lib/env';
import vercelConfig from '@/vercel.json';

const PING_URL = 'https://hc-ping.com/0b6c8f3e-1111-4222-8333-944455556666';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  for (const name of Object.values(CRON_HEARTBEAT_ENV_VARS)) vi.stubEnv(name, undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('countsOnly', () => {
  it('keeps numbers and booleans, nested ones too, and drops everything else', () => {
    expect(
      countsOnly({
        sent: 3,
        capped: false,
        email: 'someone@example.com',
        ids: [1, 2],
        at: new Date(),
        nothing: null,
        notANumber: NaN,
        reminders: { sent: 1, name: 'Ann', list: { title: 'Birthday' } },
        empty: { who: 'x' },
      })
    ).toEqual({ sent: 3, capped: false, reminders: { sent: 1 } });
  });

  it('stops at a fixed depth', () => {
    expect(countsOnly({ a: { b: { c: { d: { e: 1 } }, n: 2 } } })).toEqual({ a: { b: { n: 2 } } });
  });
});

describe('CRON_HEARTBEAT_ENV_VARS', () => {
  it('has a check for every cron vercel.json schedules, and none for anything else', () => {
    const crons = (vercelConfig as { crons: { path: string }[] }).crons.map((c) =>
      c.path.replace('/api/cron/', '')
    );
    expect(Object.keys(CRON_HEARTBEAT_ENV_VARS).sort()).toEqual(crons.sort());
  });
});

describe('getCronHeartbeatUrl', () => {
  it('is null when unset, empty or not https', () => {
    expect(getCronHeartbeatUrl('birthdays')).toBeNull();
    vi.stubEnv('HEALTHCHECK_URL_BIRTHDAYS', '  ');
    expect(getCronHeartbeatUrl('birthdays')).toBeNull();
    vi.stubEnv('HEALTHCHECK_URL_BIRTHDAYS', 'http://hc-ping.com/abc');
    expect(getCronHeartbeatUrl('birthdays')).toBeNull();
    vi.stubEnv('HEALTHCHECK_URL_BIRTHDAYS', 'not a url');
    expect(getCronHeartbeatUrl('birthdays')).toBeNull();
  });

  it('reads each cron from its own variable', () => {
    vi.stubEnv('HEALTHCHECK_URL_BIRTHDAYS', PING_URL);
    expect(getCronHeartbeatUrl('birthdays')).toBe(PING_URL);
    expect(getCronHeartbeatUrl('occasion-reminders')).toBeNull();
  });
});

describe('pingCronHeartbeat', () => {
  it('sends nothing when the cron has no URL', async () => {
    vi.stubEnv('HEALTHCHECK_URL_OCCASION_REMINDERS', PING_URL);
    await pingCronHeartbeat('birthdays', { sent: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the counts only, with a short timeout', async () => {
    vi.stubEnv('HEALTHCHECK_URL_OCCASION_REMINDERS', PING_URL);
    fetchMock.mockResolvedValue(new Response('OK'));
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    await pingCronHeartbeat('occasion-reminders', { sent: 2, capped: true, who: 'ann' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PING_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ sent: 2, capped: true });
    expect(timeout).toHaveBeenCalledWith(HEARTBEAT_TIMEOUT_MS);
    expect(HEARTBEAT_TIMEOUT_MS).toBeLessThanOrEqual(5_000);
  });

  it('swallows a network failure and logs it without the URL', async () => {
    vi.stubEnv('HEALTHCHECK_URL_BIRTHDAYS', PING_URL);
    fetchMock.mockRejectedValue(
      Object.assign(new Error(`connect failed ${PING_URL}`), { name: 'TypeError' })
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(pingCronHeartbeat('birthdays', { sent: 1 })).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('hc-ping.com');
  });

  it('swallows a timeout', async () => {
    vi.stubEnv('HEALTHCHECK_URL_BIRTHDAYS', PING_URL);
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        // A server that never answers: only the timeout ends it.
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
        })
    );
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('', 'TimeoutError')), 10);
      return controller.signal;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(pingCronHeartbeat('birthdays')).resolves.toBeUndefined();
    expect(log.mock.calls[0][1]).toEqual({ name: 'TimeoutError', code: 23 });
  });

  it('logs a refused ping by its status, without the URL', async () => {
    vi.stubEnv('HEALTHCHECK_URL_GIFT_REMINDERS', PING_URL);
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(pingCronHeartbeat('gift-reminders')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith('Cron heartbeat for gift-reminders was refused (HTTP 404)');
  });
});
