import { describe, it, expect, beforeEach, vi } from 'vitest';

// regression: the email's logo was rendered with sharp, so sign-in shipped and
// loaded it, and when sharp's native libvips was missing from the Vercel bundle
// sign-in failed with a 500 (WIS-156). The logo is pre-rendered now, so libvips
// no longer ships with the sign-in page (WIS-208), and that page's build trace
// can't show sharp creeping back: every page's trace carries sharp's binding,
// from the share cards' metadata. This can. The sign-in form's server action,
// and the email Auth.js has it send, run here with a sharp that can't load.
const { loadSharp, sendMail } = vi.hoisted(() => ({
  loadSharp: vi.fn(() => {
    throw new Error('ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.7: cannot open shared object file');
  }),
  sendMail: vi.fn(),
}));
vi.mock('sharp', loadSharp);
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.7' })),
}));
vi.mock('@/lib/auth', () => ({ signIn: vi.fn() }));

import { signIn } from '@/lib/auth';
import { requestMagicLink } from '@/app/auth/signin/actions';
import { sendVerificationRequest } from '@/lib/signInEmail';

const EMAIL = 'friend@example.com';
const SENT_URL = 'http://localhost:3000/api/auth/verify-request?provider=nodemailer&type=email';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', undefined);
  vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
  sendMail.mockReset();
  sendMail.mockResolvedValue({ accepted: [EMAIL], rejected: [] });
  // As Auth.js's signIn does: the provider's sendVerificationRequest sends it.
  vi.mocked(signIn).mockReset();
  vi.mocked(signIn).mockImplementation(async () => {
    await sendVerificationRequest({
      identifier: EMAIL,
      url: 'http://localhost:3000/api/auth/callback/nodemailer?token=secret-token-123',
      request: new Request('http://localhost:3000/api/auth/signin/nodemailer', { method: 'POST' }),
    } as Parameters<typeof sendVerificationRequest>[0]);
    return SENT_URL;
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('signing in with a sharp that cannot load', () => {
  it('sends the magic link, logo included, without ever loading sharp', async () => {
    expect(await requestMagicLink({ email: EMAIL })).toEqual({ ok: true });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      to: EMAIL,
      attachments: [expect.objectContaining({ cid: 'wishlist-logo', filename: 'logo.png' })],
    });
    expect(loadSharp).not.toHaveBeenCalled();
  });
});
