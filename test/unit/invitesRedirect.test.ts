import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redirect } = vi.hoisted(() => ({
  // Like Next's, it never returns: it throws to end the render.
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`);
  }),
}));
vi.mock('next/navigation', () => ({ redirect }));

import InvitesPage from '@/app/invites/page';
import { activityPath } from '@/lib/utils/activityPath';

beforeEach(() => {
  redirect.mockClear();
});

/** Where opening `/invites` with `params` sends the browser. */
async function redirectFor(params: Record<string, string | string[] | undefined>) {
  await expect(InvitesPage({ searchParams: Promise.resolve(params) })).rejects.toThrow(
    'NEXT_REDIRECT'
  );
  expect(redirect).toHaveBeenCalledTimes(1);
  return redirect.mock.calls[0][0];
}

// Invitations moved into Activity (WIS-250). Invite emails link to /invites,
// and sign-in continues to it as a callbackUrl, so the old address has to keep
// landing somewhere that answers them, with whatever query it was given.
describe('/invites', () => {
  it('sends you to Activity', async () => {
    expect(await redirectFor({})).toBe('/notifications');
  });

  it('keeps its query on the way', async () => {
    expect(await redirectFor({ invite: 'abc123', utm_source: 'email' })).toBe(
      '/notifications?invite=abc123&utm_source=email'
    );
  });

  it('keeps every value of a repeated key, and encodes them', async () => {
    expect(await redirectFor({ tag: ['a b', 'c&d'], empty: '' })).toBe(
      '/notifications?tag=a+b&tag=c%26d&empty='
    );
  });
});

describe('activityPath', () => {
  it('leaves out a key with no value at all', () => {
    expect(activityPath({ gone: undefined })).toBe('/notifications');
  });

  it('round-trips the query it was given', () => {
    const url = new URL(activityPath({ invite: 'x/y?z', n: '1' }), 'http://x');
    expect(url.pathname).toBe('/notifications');
    expect(url.searchParams.get('invite')).toBe('x/y?z');
    expect(url.searchParams.get('n')).toBe('1');
  });
});
