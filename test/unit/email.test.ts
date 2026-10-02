import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SMTP_ENV_VARS } from '@/lib/env';
import { EMAIL_LOGO_PNG_BASE64 } from '@/lib/emailLogo';

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

/** The magic link as it must appear in HTML, where a raw `&` isn't valid. */
const MAGIC_LINK_HTML = MAGIC_LINK.replaceAll('&', '&amp;');

/** The message handed to nodemailer by the (only) send in the test. */
function sentMessage() {
  expect(sendMail).toHaveBeenCalledTimes(1);
  return sendMail.mock.calls[0]![0] as {
    to: string;
    subject: string;
    html: string;
    text: string;
  };
}

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
    // HTML-escaped (`&` → `&amp;`), which a mail client decodes back to the same URL.
    expect(message.html).toContain(MAGIC_LINK_HTML);
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

describe('the inline logo', () => {
  type Sent = { attachments: { cid: string; filename: string; content: Buffer }[] };

  afterEach(() => {
    vi.doUnmock('sharp');
  });

  it('embeds the pre-rendered logo as an inline 96×96 PNG', async () => {
    const { sendMagicLinkEmail } = await loadEmail('smtp');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    const { attachments } = sentMessage() as unknown as Sent;
    expect(attachments).toHaveLength(1);
    const [logo] = attachments;
    expect(logo).toMatchObject({ cid: 'wishlist-logo', filename: 'logo.png' });
    expect(logo.content.equals(Buffer.from(EMAIL_LOGO_PNG_BASE64, 'base64'))).toBe(true);
    // A PNG whose IHDR says 96×96.
    expect(logo.content.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
    expect([logo.content.readUInt32BE(16), logo.content.readUInt32BE(20)]).toEqual([96, 96]);
    expect(sentMessage().html).toContain('src="cid:wishlist-logo"');
  });

  // regression: lib/email.ts rendered the logo with sharp. NextAuth and the
  // sign-in form's action import it, so sign-in shipped and loaded sharp, and
  // when sharp's native libvips was missing from the Vercel bundle every
  // /api/auth/* request failed with a 500 (WIS-156). Now the logo is
  // pre-rendered and sending an email never loads sharp (WIS-208).
  it('sends the sign-in email, logo included, without ever loading sharp', async () => {
    const loadSharp = vi.fn(() => {
      throw new Error(
        'Could not load the "sharp" module using the linux-x64 runtime\n' +
          'ERR_DLOPEN_FAILED: libvips-cpp.so.8.18.3: cannot open shared object file'
      );
    });
    vi.doMock('sharp', loadSharp);
    const { sendMagicLinkEmail } = await loadEmail('smtp');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    const [logo] = (sentMessage() as unknown as Sent).attachments;
    expect(logo).toMatchObject({ cid: 'wishlist-logo', filename: 'logo.png' });
    expect(loadSharp).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe('user-controlled values in email HTML', () => {
  // All five characters that matter in HTML text and quoted attributes.
  const MARKUP_NAME = `<a href="https://evil.example">Click & 'accept'</a>`;
  const MARKUP_NAME_HTML =
    '&lt;a href=&quot;https://evil.example&quot;&gt;Click &amp; &#39;accept&#39;&lt;/a&gt;';

  // regression: the invite email interpolated the wishlist name (free text) raw
  // into its HTML, so any owner could put a live link or image in a mail sent
  // from our domain to anyone whose `whoCanInvite` let them invite.
  it('escapes a wishlist name in the invite HTML and keeps it verbatim in the text and subject', async () => {
    const { sendWishlistInvitationEmail } = await loadEmail('smtp');

    await sendWishlistInvitationEmail(RECIPIENT, MARKUP_NAME, 'alice');

    const { html, text, subject } = sentMessage();
    expect(html).not.toContain('<a href="https://evil.example"');
    expect(html).toContain(`<h2>You’re invited to “${MARKUP_NAME_HTML}”</h2>`);
    expect(html).toContain(`their wishlist <strong>${MARKUP_NAME_HTML}</strong>.`);
    expect(text).toContain(`join their wishlist: ${MARKUP_NAME}.`);
    expect(subject).toBe(`You've been invited to ${MARKUP_NAME} on Wishlist!`);
  });

  // regression: the inviter's display name was interpolated raw too, and it isn't
  // always a regex-bound username: the invite routes fall back to other sources.
  it("escapes the inviter's name and the recipient's address", async () => {
    const { sendWishlistInvitationEmail } = await loadEmail('smtp');
    const address = "o'brien@example.com";

    await sendWishlistInvitationEmail(address, 'Birthday', '<img src=x onerror=alert(1)>');

    const { html, text } = sentMessage();
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong> invited you');
    expect(html).toContain('Invitation sent to <strong>o&#39;brien@example.com</strong>');
    expect(text).toContain('<img src=x onerror=alert(1)> has invited you');
  });

  it('escapes the magic link in the button and the paste-this-link fallback', async () => {
    const { sendMagicLinkEmail } = await loadEmail('smtp');

    await sendMagicLinkEmail(RECIPIENT, MAGIC_LINK);

    const { html, text } = sentMessage();
    expect(html).toContain(`<a href="${MAGIC_LINK_HTML}" class="email-button">Sign in</a>`);
    expect(html).toContain(`<a href="${MAGIC_LINK_HTML}">${MAGIC_LINK_HTML}</a>`);
    expect(html).not.toContain(MAGIC_LINK);
    expect(text).toContain(MAGIC_LINK);
  });

  // The subject takes the wishlist name raw, and a name can hold a line break.
  // Nodemailer is what stops that starting a new header, so render the message we
  // hand it with the real library and check the result.
  it('cannot inject a header through a wishlist name in the subject', async () => {
    const { sendWishlistInvitationEmail } = await loadEmail('smtp');

    await sendWishlistInvitationEmail(RECIPIENT, 'Birthday\r\nBcc: attacker@evil.example', 'alice');

    const realNodemailer = await vi.importActual<typeof import('nodemailer')>('nodemailer');
    const info = await realNodemailer
      .createTransport({ streamTransport: true, buffer: true, newline: 'unix' })
      .sendMail(sentMessage());
    expect(info.envelope.to).toEqual([RECIPIENT]);
    const headers = info.message
      .toString()
      .split('\n\n')[0]!
      .replace(/\n[ \t]+/g, ' '); // unfold continuation lines
    expect(headers).not.toMatch(/^Bcc:/im);
    expect(headers).toMatch(
      /^Subject: You've been invited to Birthday +Bcc: attacker@evil\.example on Wishlist!$/m
    );
  });
});
