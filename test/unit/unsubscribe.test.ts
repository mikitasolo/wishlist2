import { describe, it, expect, afterEach, vi } from 'vitest';
import { unsubscribeQuery, unsubscribeUrls, verifyUnsubscribe } from '@/lib/utils/unsubscribe';

const USER = '64b7f0c2a1b2c3d4e5f60718';
const OTHER = '64b7f0c2a1b2c3d4e5f60719';

function parts(query: string) {
  const p = new URLSearchParams(query);
  return { u: p.get('u'), e: p.get('e'), t: p.get('t') };
}

afterEach(() => vi.unstubAllEnvs());

describe('unsubscribe links', () => {
  it('verifies a link it signed, for that account and event', () => {
    const query = unsubscribeQuery({ userId: USER, event: 'join_request' });
    expect(verifyUnsubscribe(parts(query))).toEqual({ userId: USER, event: 'join_request' });
  });

  it('carries the account id and event, never anything else about the account', () => {
    const { page, oneClick } = unsubscribeUrls('https://wish.example', {
      userId: USER,
      event: 'proposal',
    });
    expect(page.startsWith('https://wish.example/unsubscribe?')).toBe(true);
    expect(oneClick.startsWith('https://wish.example/api/unsubscribe?')).toBe(true);
    expect([...new URL(page).searchParams.keys()]).toEqual(['u', 'e', 't']);
  });

  it('refuses a signature moved to another account or another event', () => {
    const { t } = parts(unsubscribeQuery({ userId: USER, event: 'join_request' }));
    expect(verifyUnsubscribe({ u: OTHER, e: 'join_request', t })).toBeNull();
    expect(verifyUnsubscribe({ u: USER, e: 'proposal', t })).toBeNull();
  });

  it('refuses a tampered, truncated or missing part', () => {
    const good = parts(unsubscribeQuery({ userId: USER, event: 'join_request' }));
    const flipped = good.t!.slice(0, -1) + (good.t!.endsWith('A') ? 'B' : 'A');
    expect(verifyUnsubscribe({ ...good, t: flipped })).toBeNull();
    expect(verifyUnsubscribe({ ...good, t: good.t!.slice(0, 10) })).toBeNull();
    expect(verifyUnsubscribe({ ...good, t: null })).toBeNull();
    expect(verifyUnsubscribe({ ...good, u: 'not-an-id' })).toBeNull();
    expect(verifyUnsubscribe({ ...good, e: undefined })).toBeNull();
  });

  it('refuses an event that has no email, even signed', () => {
    // A follow has no email to turn off: no link names it, and none verifies.
    expect(verifyUnsubscribe({ u: USER, e: 'follow', t: 'x' })).toBeNull();
    expect(verifyUnsubscribe({ u: USER, e: 'role_changed', t: 'x' })).toBeNull();
  });

  it('refuses a link signed under another secret', () => {
    const query = unsubscribeQuery({ userId: USER, event: 'join_request' });
    vi.stubEnv('NEXTAUTH_SECRET', 'a-rotated-secret');
    expect(verifyUnsubscribe(parts(query))).toBeNull();
  });
});
