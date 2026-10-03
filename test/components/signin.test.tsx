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
