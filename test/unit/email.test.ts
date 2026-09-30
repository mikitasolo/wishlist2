import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SMTP_ENV_VARS } from '@/lib/env';

// Stand-in for nodemailer: proves whether a transporter is ever created or
// used, without dialing anything.
const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn();
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

const RECIPIENT = 'friend@example.com';
const MAGIC_LINK =
  'http://localhost:3000/api/auth/callback/nodemailer?token=secret-token-123&email=friend%40example.com';
const INVITES_LINK = `http://localhost:3000/auth/signin?callbackUrl=${encodeURIComponent('/invites')}`;

let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

/** Everything written to the console during the test, as one string. */
function consoleOutput(): string {
  return [...log.mock.calls, ...error.mock.calls]
    .flat()
    .map((arg) => (arg instanceof Error ? `${arg.message}\n${arg.stack}` : String(arg)))
    .join('\n');
}

/** A rejected-recipient failure shaped like nodemailer's (it names the address). */
function rejectedRecipientError() {
  return Object.assign(
    new Error(
      `Can't send mail - all recipients were rejected: 550 5.1.1 <${RECIPIENT}>: Recipient address rejected`
    ),
    {
      code: 'EENVELOPE',
      responseCode: 550,
      command: 'RCPT TO',
      response: `550 5.1.1 <${RECIPIENT}>: Recipient address rejected`,
      rejected: [RECIPIENT],
    }
  );
}

/**
 * lib/email reads the transport once at import, so re-import it after setting
 * the env for the mode under test.
 */
async function loadEmail(transport: 'smtp' | 'console') {
  vi.stubEnv('EMAIL_TRANSPORT', transport);
  if (transport === 'console') {
    // Console mode must work with no SMTP config at all.
    for (const name of SMTP_ENV_VARS) vi.stubEnv(name, undefined);
  }
  vi.resetModules();
  return import('@/lib/email');
}

beforeEach(() => {
  vi.stubEnv('VERCEL_ENV', undefined);
  createTransport.mockClear();
  sendMail.mockReset();
  sendMail.mockResolvedValue({ accepted: [RECIPIENT], rejected: [] });
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('EMAIL_TRANSPORT=console', () => {
  it('sendMagicLinkEmail logs the recipient, subject and magic link and sends nothing', async () => {
    const { sendMagicLinkEmail } = await loadEmail('console');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    const printed = String(log.mock.calls[0]![0]);
    expect(printed).toContain(`To:      ${RECIPIENT}`);
    expect(printed).toContain('Subject: Sign in to Wishlist');
    expect(printed).toContain(`Link:    ${MAGIC_LINK}`);
    expect(printed).toContain('not sent');
  });

  it('prints only the recipient, subject and link, not the email body', async () => {
    const { sendMagicLinkEmail } = await loadEmail('console');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    const printed = String(log.mock.calls[0]![0]);
    expect(printed).not.toContain('<html');
    expect(printed).not.toContain('expire in 24 hours');
  });

  it('sendWishlistInvitationEmail logs the invitations link and sends nothing', async () => {
    const { sendWishlistInvitationEmail } = await loadEmail('console');

    await sendWishlistInvitationEmail(RECIPIENT, 'Birthday', 'alice');

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    const printed = String(log.mock.calls[0]![0]);
    expect(printed).toContain(`To:      ${RECIPIENT}`);
    expect(printed).toContain("Subject: You've been invited to Birthday on Wishlist!");
    expect(printed).toContain(`Link:    ${INVITES_LINK}`);
  });
});

describe('EMAIL_TRANSPORT=smtp', () => {
  it('sends the magic link through the SMTP transporter', async () => {
    const { sendMagicLinkEmail } = await loadEmail('smtp');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 587,
      secure: false,
      auth: { user: 'test', pass: 'test' },
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0]![0];
    expect(message).toMatchObject({
      from: 'test@example.com',
      to: RECIPIENT,
      subject: 'Sign in to Wishlist',
    });
    expect(message.text).toContain(MAGIC_LINK);
    expect(message.html).toContain(MAGIC_LINK);
  });

  it('is the default when EMAIL_TRANSPORT is unset', async () => {
    vi.stubEnv('EMAIL_TRANSPORT', undefined);
    vi.resetModules();
    const { sendMagicLinkEmail } = await import('@/lib/email');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  // regression: smtp sends used to log "Magic link email sent to: <address>".
  // Only the console transport may print a recipient or a link.
  it('never logs the recipient or the magic link', async () => {
    const { sendMagicLinkEmail } = await loadEmail('smtp');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    expect(log).toHaveBeenCalledWith('Sent magic link email');
    const output = consoleOutput();
    expect(output).not.toContain(RECIPIENT);
    expect(output).not.toContain(MAGIC_LINK);
    expect(output).not.toContain('secret-token-123');
  });

  // regression: smtp sends used to log "Wishlist invitation email sent to: <address>".
  it('sends the invitation without logging the recipient or link', async () => {
    const { sendWishlistInvitationEmail } = await loadEmail('smtp');

    await sendWishlistInvitationEmail(RECIPIENT, 'Birthday', 'alice');

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      to: RECIPIENT,
      subject: "You've been invited to Birthday on Wishlist!",
    });
    expect(log).toHaveBeenCalledWith('Sent wishlist invitation email');
    const output = consoleOutput();
    expect(output).not.toContain(RECIPIENT);
    expect(output).not.toContain(INVITES_LINK);
  });

  // regression: a failed send used to log (and rethrow) nodemailer's raw error,
  // whose message and `rejected`/`response` fields name the recipient.
  it('keeps the recipient out of the log and the rethrown error when a send fails', async () => {
    const { sendMagicLinkEmail } = await loadEmail('smtp');
    sendMail.mockRejectedValue(rejectedRecipientError());

    const thrown = await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK).then(
      () => null,
      (err: unknown) => err
    );

    expect(thrown).toBeInstanceOf(Error);
    const rethrown = thrown as Error;
    expect(rethrown.message).toBe(
      'Could not send magic link email (Error code=EENVELOPE responseCode=550 command=RCPT TO)'
    );
    expect(JSON.stringify({ ...rethrown, cause: rethrown.cause })).not.toContain(RECIPIENT);
    expect(error).toHaveBeenCalledWith(
      'Error sending magic link email: Error code=EENVELOPE responseCode=550 command=RCPT TO'
    );
    const output = consoleOutput();
    expect(output).not.toContain(RECIPIENT);
    expect(output).not.toContain(MAGIC_LINK);
  });

  it('still reports a failure that is not a nodemailer error', async () => {
    const { sendWishlistInvitationEmail } = await loadEmail('smtp');
    sendMail.mockRejectedValue('socket closed');

    await expect(sendWishlistInvitationEmail(RECIPIENT, 'Birthday', 'alice')).rejects.toThrow(
      'Could not send wishlist invitation email (unknown error)'
    );
  });
});
