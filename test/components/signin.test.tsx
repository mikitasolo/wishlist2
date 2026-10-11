// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/auth/signin/actions', () => ({ requestMagicLink: vi.fn() }));
// Signed out: the page shows the form. Redirecting a signed-in visitor is
// test/api/signInPageRedirect.test.ts.
vi.mock('@/lib/auth', () => ({ auth: vi.fn(async () => null) }));

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams('') }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
  redirect: vi.fn(),
}));

// The page reads NEXTAUTH_URL's origin, which `getEnvVars` refuses to give a
// browser (jsdom has a `window`); the Turnstile keys stay real.
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  getEnvVars: () => ({ NEXTAUTH_URL: 'http://localhost:3000' }),
}));

const connection = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('next/server', () => ({ connection }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { requestMagicLink } from '@/app/auth/signin/actions';
import SignInForm, {
  CHALLENGE_FAILED_MESSAGE,
  CHALLENGE_LOAD_FAILED_MESSAGE,
  RESENT_MESSAGE,
  SEND_FAILED_MESSAGE,
  TOKEN_WAIT_MS,
} from '@/app/auth/signin/SignInForm';
import SignInPage from '@/app/auth/signin/page';
import { TURNSTILE_SCRIPT_URL, type TurnstileApi } from '@/components/TurnstileWidget';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';

const mockedRequest = vi.mocked(requestMagicLink);
const SITE_KEY = '1x00000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

type RenderOptions = Parameters<TurnstileApi['render']>[1];

/** A stand-in for Cloudflare's `window.turnstile`; `pass()` plays the check passing, and so on. */
function fakeTurnstile() {
  let options: RenderOptions | null = null;
  const api = {
    render: vi.fn((_container: HTMLElement, opts: RenderOptions) => {
      options = opts;
      return 'widget-1';
    }),
    reset: vi.fn(),
    remove: vi.fn(),
  } satisfies TurnstileApi;
  return {
    api,
    // Async acts, so the submit a token unblocks settles inside them.
    pass: (token = TOKEN) => act(async () => options!.callback!(token)),
    expire: () => act(async () => options!['expired-callback']!()),
    error: () => act(async () => options!['error-callback']!('110200')),
    showChallenge: () => act(async () => options!['before-interactive-callback']!()),
    hideChallenge: () => act(async () => options!['after-interactive-callback']!()),
  };
}

async function typeEmail() {
  await userEvent.type(screen.getByLabelText(/email address/i), 'me@example.com');
}

const sendButton = () => screen.getByRole('button', { name: /send magic link/i });

beforeEach(() => {
  cleanup();
  mockedRequest.mockReset();
  searchParams.current = new URLSearchParams('');
  delete window.turnstile;
  document.head.querySelectorAll('script').forEach((script) => script.remove());
});
afterEach(() => {
  delete window.turnstile;
  vi.restoreAllMocks();
});

describe('SignInForm — submit result handling', () => {
  it('shows the "check your email" screen when the link was sent', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    render(<SignInForm />);

    await typeEmail();
    await userEvent.click(sendButton());

    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('passes the email and the callbackUrl (e.g. an invite link) to the server action', async () => {
    searchParams.current = new URLSearchParams('callbackUrl=%2Finvites');
    mockedRequest.mockResolvedValue({ ok: true });
    render(<SignInForm />);

    await typeEmail();
    await userEvent.click(sendButton());

    expect(mockedRequest).toHaveBeenCalledWith({
      email: 'me@example.com',
      callbackUrl: '/invites',
      turnstileToken: null,
    });
  });

  // regression: a blocked send (e.g. the sign-in rate limit) must surface an
  // error, not the false "check your email" success screen.
  it('surfaces an error and does NOT claim success when the send is blocked', async () => {
    mockedRequest.mockResolvedValue({ ok: false, error: 'send_failed' });
    render(<SignInForm />);

    await typeEmail();
    await userEvent.click(sendButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't send your magic link/i);
    expect(screen.queryByText(/check your email/i)).toBeNull();
  });

  it('surfaces the same error when the server action itself fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedRequest.mockRejectedValue(new Error('network down'));
    render(<SignInForm />);

    await typeEmail();
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't send your magic link/i);
  });
});

describe('SignInForm — Turnstile widget', () => {
  /** Render the form with Turnstile on and wait for the widget to be rendered. */
  async function renderWithWidget() {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    const view = render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
    return { turnstile, ...view };
  }

  const sentToken = () => mockedRequest.mock.calls.at(-1)?.[0].turnstileToken;

  it('renders no widget and loads no Cloudflare script without a site key', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    mockedRequest.mockResolvedValue({ ok: true });
    render(<SignInForm />);

    expect(turnstile.api.render).not.toHaveBeenCalled();
    expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)).toBeNull();

    await typeEmail();
    await userEvent.click(sendButton());
    expect(sentToken()).toBeNull();
  });

  it('renders the widget with the site key when one is set', async () => {
    const { turnstile } = await renderWithWidget();

    expect(turnstile.api.render).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        sitekey: SITE_KEY,
        action: 'signin',
        appearance: 'interaction-only',
      })
    );
  });

  // regression: Turnstile's iframe (and the old wrapper's margin) gave the
  // centred sign-in card extra height as soon as the widget rendered: CLS 0.56.
  it('takes no room until Cloudflare asks for a click, then opens up', async () => {
    const { turnstile, container } = await renderWithWidget();
    const box = () => container.querySelector('[data-interactive], .h-0') as HTMLElement;

    expect(box()).toHaveClass('h-0', 'overflow-hidden');
    await turnstile.showChallenge();
    expect(box()).not.toHaveClass('h-0');
    expect(box()).toHaveClass('mt-6');
    await turnstile.hideChallenge();
    expect(box()).toHaveClass('h-0');

    // An error shows Cloudflare's message, so it opens too; a passing check closes it.
    await turnstile.error();
    expect(box()).toHaveClass('mt-6');
    await turnstile.pass();
    expect(box()).toHaveClass('h-0');
  });

  it("loads Cloudflare's script once, then renders into it", async () => {
    const turnstile = fakeTurnstile();
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);

    const scripts = document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`);
    expect(scripts).toHaveLength(1);
    expect(turnstile.api.render).not.toHaveBeenCalled();

    window.turnstile = turnstile.api;
    await act(async () => {
      scripts[0]!.dispatchEvent(new Event('load'));
    });
    expect(turnstile.api.render).toHaveBeenCalledTimes(1);
  });

  it('sends the token with the email', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const { turnstile } = await renderWithWidget();

    await turnstile.pass();
    await typeEmail();
    await userEvent.click(sendButton());

    expect(mockedRequest).toHaveBeenCalledWith({
      email: 'me@example.com',
      callbackUrl: '/',
      turnstileToken: TOKEN,
    });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  // The invisible check takes a moment after the page loads: a quick submit
  // waits for it rather than going without.
  it('waits for a token that is still on its way', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const { turnstile } = await renderWithWidget();

    await typeEmail();
    await userEvent.click(sendButton());
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /sending link/i })).toBeDisabled();

    await turnstile.pass();
    await vi.waitFor(() => expect(sentToken()).toBe(TOKEN));
  });

  it('waits for a fresh token once the last one expired', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const { turnstile } = await renderWithWidget();

    await turnstile.pass('expired-token');
    await turnstile.expire();
    await typeEmail();
    await userEvent.click(sendButton());
    expect(mockedRequest).not.toHaveBeenCalled();

    await turnstile.pass();
    await vi.waitFor(() => expect(sentToken()).toBe(TOKEN));
  });

  it(`sends without a token when none arrives within ${TOKEN_WAIT_MS} ms`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      mockedRequest.mockResolvedValue({ ok: false, error: 'challenge' });
      const { turnstile } = await renderWithWidget();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

      await user.type(screen.getByLabelText(/email address/i), 'me@example.com');
      await user.click(sendButton());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(TOKEN_WAIT_MS - 100);
      });
      expect(mockedRequest).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });

      // The server decides; with Cloudflare up it refuses.
      expect(sentToken()).toBeNull();
      expect(await screen.findByRole('alert')).toHaveTextContent(CHALLENGE_FAILED_MESSAGE);
      // No token was spent, so the widget is left alone: a reset would throw
      // away an interactive challenge the visitor may be halfway through.
      expect(turnstile.api.reset).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Turnstile retries by itself after an error, so the submit keeps waiting
  // for the token that retry brings, and the button never locks up meanwhile.
  it('keeps waiting through a widget error for the retried token', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    const { turnstile } = await renderWithWidget();

    await turnstile.pass('old-token');
    await turnstile.error();
    await typeEmail();
    expect(sendButton()).toBeEnabled();
    await userEvent.click(sendButton());
    expect(mockedRequest).not.toHaveBeenCalled();

    await turnstile.pass();
    await vi.waitFor(() => expect(sentToken()).toBe(TOKEN));
  });

  // No widget at all: the form doesn't wait, and the server refuses a missing
  // token unless Cloudflare is down, so an outage doesn't lock everyone out.
  it('sends without a token straight away when the widget fails to render', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedRequest.mockResolvedValue({ ok: true });
    window.turnstile = {
      render: vi.fn(() => {
        throw new Error('Invalid site key');
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(CHALLENGE_LOAD_FAILED_MESSAGE);
    await typeEmail();
    await userEvent.click(sendButton());

    expect(sentToken()).toBeNull();
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  it('says so when the script fails to load, and still lets the server decide', async () => {
    mockedRequest.mockResolvedValue({ ok: false, error: 'challenge' });
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    const script = document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)!;

    await act(async () => {
      script.dispatchEvent(new Event('error'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(CHALLENGE_LOAD_FAILED_MESSAGE);
    // The failed tag is dropped, so a remount can try again.
    expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)).toBeNull();

    await typeEmail();
    await userEvent.click(sendButton());
    expect(sentToken()).toBeNull();
    // Refused while Cloudflare answers: the explanation stays the load failure.
    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(CHALLENGE_LOAD_FAILED_MESSAGE)
    );
  });

  it('asks to complete the check when the server refuses the token, and fetches a fresh one', async () => {
    mockedRequest.mockResolvedValue({ ok: false, error: 'challenge' });
    const { turnstile } = await renderWithWidget();

    await turnstile.pass();
    await typeEmail();
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(CHALLENGE_FAILED_MESSAGE);
    expect(screen.queryByText(/check your email/i)).toBeNull();
    // A token passes one check: the spent one is dropped and a new one asked for.
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');

    // The retry waits for that new token instead of resending the spent one.
    mockedRequest.mockResolvedValue({ ok: true });
    await userEvent.click(sendButton());
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    await turnstile.pass('fresh-token');
    await vi.waitFor(() => expect(sentToken()).toBe('fresh-token'));
  });

  it('fetches a fresh token after a failed send too', async () => {
    mockedRequest.mockResolvedValue({ ok: false, error: 'send_failed' });
    const { turnstile } = await renderWithWidget();

    await turnstile.pass();
    await typeEmail();
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't send your magic link/i);
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');
  });

  it('removes the widget when the form goes away', async () => {
    const { turnstile, unmount } = await renderWithWidget();

    unmount();
    expect(turnstile.api.remove).toHaveBeenCalledWith('widget-1');
  });

  describe('theme', () => {
    afterEach(() => {
      document.documentElement.removeAttribute('data-theme');
      localStorage.clear();
    });

    const renderedTheme = (turnstile: ReturnType<typeof fakeTurnstile>) =>
      turnstile.api.render.mock.calls.at(-1)?.[1].theme;

    /** The app's own light/dark switch, as the account menu has it. */
    function ThemeSwitch() {
      const { theme, setTheme } = useTheme();
      return (
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          Switch theme
        </button>
      );
    }

    // regression: the widget was rendered with Turnstile's `theme: 'auto'`, which
    // follows the OS colour scheme, so a dark app on a light OS got a light challenge.
    it.each(['light', 'dark'] as const)(
      "renders the widget in the app's %s theme",
      async (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        const { turnstile } = await renderWithWidget();

        expect(renderedTheme(turnstile)).toBe(theme);
      }
    );

    // The page as the app serves it: a saved dark choice, put on <html> by the
    // layout's inline script, with the real ThemeProvider (which starts at light).
    it("renders in a saved dark theme on the first load, inside the app's ThemeProvider", async () => {
      localStorage.setItem('theme', 'dark');
      // What the layout's inline script does before paint.
      document.documentElement.setAttribute('data-theme', 'dark');
      const turnstile = fakeTurnstile();
      window.turnstile = turnstile.api;
      render(
        <ThemeProvider>
          <SignInForm turnstileSiteKey={SITE_KEY} />
        </ThemeProvider>
      );

      await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
      expect(renderedTheme(turnstile)).toBe('dark');
    });

    it('takes the theme in effect once the script has loaded, not when the form mounted', async () => {
      document.documentElement.setAttribute('data-theme', 'light');
      const turnstile = fakeTurnstile();
      render(<SignInForm turnstileSiteKey={SITE_KEY} />);
      const script = document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)!;

      document.documentElement.setAttribute('data-theme', 'dark');
      window.turnstile = turnstile.api;
      await act(async () => {
        script.dispatchEvent(new Event('load'));
      });

      expect(renderedTheme(turnstile)).toBe('dark');
    });

    // Turnstile can't change a widget's theme in place, and a new widget would
    // throw away the token it holds or the check it's running.
    it.each([
      ['holding a token', true],
      ['still checking', false],
    ])('keeps the widget when the app theme changes while it is %s', async (_label, holding) => {
      mockedRequest.mockResolvedValue({ ok: true });
      const turnstile = fakeTurnstile();
      window.turnstile = turnstile.api;
      render(
        <ThemeProvider>
          <ThemeSwitch />
          <SignInForm turnstileSiteKey={SITE_KEY} />
        </ThemeProvider>
      );
      await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
      expect(renderedTheme(turnstile)).toBe('light');

      if (holding) await turnstile.pass();
      await userEvent.click(screen.getByRole('button', { name: /switch theme/i }));
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      if (!holding) await turnstile.pass();

      expect(turnstile.api.render).toHaveBeenCalledTimes(1);
      expect(turnstile.api.remove).not.toHaveBeenCalled();
      expect(turnstile.api.reset).not.toHaveBeenCalled();
      await typeEmail();
      await userEvent.click(sendButton());
      expect(sentToken()).toBe(TOKEN);
    });
  });
});

describe('SignInForm — copy and inline validation', () => {
  it('greets new and returning people alike, with no footer line', () => {
    render(<SignInForm />);

    expect(
      screen.getByRole('heading', { name: 'Sign in or create an account' })
    ).toBeInTheDocument();
    expect(screen.getByText("We'll email you a link — no password.")).toBeInTheDocument();
    expect(screen.queryByText(/welcome back/i)).toBeNull();
    expect(screen.queryByText(/new users will automatically/i)).toBeNull();
    expect(screen.queryByText(/continue to the/i)).toBeNull();
  });

  it.each([
    ['wishlist', "We'll email you a link to continue to the wishlist you opened — no password."],
    ['profile', "We'll email you a link to continue to the profile you opened — no password."],
  ] as const)('says where a %s link continues to', (destination, hint) => {
    render(<SignInForm destination={destination} />);
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('shows an inline error for an invalid email and sends nothing', async () => {
    render(<SignInForm />);
    const field = screen.getByLabelText(/email address/i);

    await userEvent.type(field, 'me.example.com');
    await userEvent.click(sendButton());

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('Enter an email address like you@example.com');
    expect(field).toHaveFocus();
    // The browser's own bubble is off: the form validates inline.
    expect(field.closest('form')).toHaveAttribute('novalidate');

    // Fixing it clears the error as you type.
    await userEvent.clear(field);
    await userEvent.type(field, 'me@example.com');
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('asks for an address when the field is empty', async () => {
    render(<SignInForm />);
    await userEvent.click(sendButton());

    expect(mockedRequest).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/email address/i)).toHaveAccessibleDescription(
      'Enter your email address'
    );
  });
});

describe('SignInForm — the link-sent card', () => {
  const resendButton = () => screen.getByRole('button', { name: /resend link/i });

  async function sendLink(email = 'me@example.com') {
    await userEvent.type(screen.getByLabelText(/email address/i), email);
    await userEvent.click(sendButton());
    await screen.findByRole('heading', { name: 'Check your email' });
  }

  it('says where the link went, and suggests the spam folder', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    render(<SignInForm />);
    await sendLink('  me@example.com ');

    expect(screen.getByText('me@example.com').closest('p')).toHaveTextContent(
      'Sent to me@example.com'
    );
    expect(screen.getByText("Can't find it? Check your spam folder.")).toBeInTheDocument();
  });

  it('goes back to the form with the address kept on Use a different email', async () => {
    mockedRequest.mockResolvedValue({ ok: true });
    render(<SignInForm />);
    await sendLink();

    await userEvent.click(screen.getByRole('button', { name: 'Use a different email' }));

    const field = screen.getByLabelText(/email address/i);
    expect(field).toHaveValue('me@example.com');
    expect(field).toHaveFocus();
    expect(sendButton()).toBeEnabled();
  });

  describe('Resend link', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });

    /** Turnstile on, a link sent with `TOKEN`. */
    async function sentWithWidget() {
      const turnstile = fakeTurnstile();
      window.turnstile = turnstile.api;
      render(<SignInForm turnstileSiteKey={SITE_KEY} />);
      await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
      await turnstile.pass();
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.type(screen.getByLabelText(/email address/i), 'me@example.com');
      await user.click(sendButton());
      await screen.findByRole('heading', { name: 'Check your email' });
      return { turnstile, user };
    }

    it('is held for 30 seconds, then sends again with a fresh Turnstile token', async () => {
      mockedRequest.mockResolvedValue({ ok: true });
      const { turnstile, user } = await sentWithWidget();
      // The first send spent its token: the widget is reset for the next one.
      expect(turnstile.api.reset).toHaveBeenCalledTimes(1);

      expect(resendButton()).toBeDisabled();
      expect(resendButton()).toHaveTextContent('Resend link in 30s');
      await advance(29_000);
      expect(resendButton()).toBeDisabled();
      await advance(1_000);
      expect(resendButton()).toBeEnabled();
      expect(resendButton()).toHaveTextContent(/^Resend link$/);

      await user.click(resendButton());
      // It waits for the token the reset asked for rather than reusing the spent one.
      expect(mockedRequest).toHaveBeenCalledTimes(1);
      await turnstile.pass('fresh-token');

      await vi.waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
      expect(mockedRequest).toHaveBeenLastCalledWith({
        email: 'me@example.com',
        callbackUrl: '/',
        turnstileToken: 'fresh-token',
      });
      expect(await screen.findByRole('status')).toHaveTextContent(RESENT_MESSAGE);
      expect(turnstile.api.reset).toHaveBeenCalledTimes(2);
      // And it's held again.
      expect(resendButton()).toBeDisabled();
    });

    // A resend spends the same fail-closed sign-in limits as the first send.
    it("shows the send's error when the resend is refused (e.g. rate-limited)", async () => {
      mockedRequest.mockResolvedValue({ ok: true });
      const { turnstile, user } = await sentWithWidget();
      await advance(30_000);

      mockedRequest.mockResolvedValue({ ok: false, error: 'send_failed' });
      await user.click(resendButton());
      await turnstile.pass('fresh-token');

      expect(await screen.findByRole('alert')).toHaveTextContent(SEND_FAILED_MESSAGE);
      expect(screen.getByRole('heading', { name: 'Check your email' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('');
      expect(resendButton()).toBeEnabled();
    });
  });
});

// The page decides whether the widget is shown, per request, from the same
// reading of the environment the server action checks tokens against.
describe('the sign-in page', () => {
  afterEach(() => vi.unstubAllEnvs());

  async function renderPageCountingWidgetScripts() {
    const page = await SignInPage({ searchParams: Promise.resolve({}) });
    render(page);
    // The form's widget renders only with a key: count Cloudflare's script tag.
    return document.querySelectorAll(`script[src="${TURNSTILE_SCRIPT_URL}"]`).length;
  }

  // The hint comes from the callback's path alone: the page reads no list, so a
  // private list's name (or whether it exists) can't reach whoever opens the link.
  it.each([
    [
      '/wishlists/anna-secret-surprise',
      "We'll email you a link to continue to the wishlist you opened — no password.",
    ],
    [
      'http://localhost:3000/users/anna',
      "We'll email you a link to continue to the profile you opened — no password.",
    ],
  ])('keeps the callbackUrl hint generic for %s', async (callbackUrl, hint) => {
    render(await SignInPage({ searchParams: Promise.resolve({ callbackUrl }) }));

    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/secret|anna/i);
  });

  it.each(['/notifications', 'https://evil.example/wishlists/abc'])(
    'adds no hint for %s',
    async (callbackUrl) => {
      render(await SignInPage({ searchParams: Promise.resolve({ callbackUrl }) }));
      expect(screen.queryByText(/continue to the/i)).toBeNull();
    }
  );

  it('shows the widget when both keys are set, rendering per request', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', SITE_KEY);
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA');
    expect(await renderPageCountingWidgetScripts()).toBe(1);
    expect(connection).toHaveBeenCalled();
  });

  it.each([
    ['neither key', {}],
    // A widget nothing would check.
    ['only the site key', { NEXT_PUBLIC_TURNSTILE_SITE_KEY: SITE_KEY }],
    ['only the secret', { TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA' }],
  ])('shows no widget with %s', async (_label, vars) => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', undefined);
    vi.stubEnv('TURNSTILE_SECRET_KEY', undefined);
    for (const [name, value] of Object.entries(vars)) vi.stubEnv(name, value);
    expect(await renderPageCountingWidgetScripts()).toBe(0);
    expect(sendButton()).toBeEnabled();
  });
});
