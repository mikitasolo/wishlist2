// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/app/auth/signin/actions', () => ({ requestMagicLink: vi.fn() }));

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams('') }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParams.current,
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
} from '@/app/auth/signin/SignInForm';
import SignInPage from '@/app/auth/signin/page';
import { TURNSTILE_SCRIPT_URL, type TurnstileApi } from '@/components/TurnstileWidget';

const mockedRequest = vi.mocked(requestMagicLink);
const SITE_KEY = '1x00000000000000000000AA';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

type RenderOptions = Parameters<TurnstileApi['render']>[1];

/** A stand-in for Cloudflare's `window.turnstile`; `pass()` plays the check passing. */
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
    pass: (token = TOKEN) => act(() => options!.callback!(token)),
    expire: () => act(() => options!['expired-callback']!()),
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
  it('renders no widget and loads no Cloudflare script without a site key', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    mockedRequest.mockResolvedValue({ ok: true });
    render(<SignInForm />);

    expect(turnstile.api.render).not.toHaveBeenCalled();
    expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)).toBeNull();
    // And nothing to wait for: the button works straight away.
    expect(sendButton()).toBeEnabled();
  });

  it('renders the widget with the site key when one is set', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);

    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
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

  it('tells the visitor when the script fails to load', async () => {
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    const script = document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)!;

    await act(async () => {
      script.dispatchEvent(new Event('error'));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent(CHALLENGE_LOAD_FAILED_MESSAGE);
    // The failed tag is dropped, so a remount can try again.
    expect(document.querySelector(`script[src="${TURNSTILE_SCRIPT_URL}"]`)).toBeNull();
  });

  it('waits for the token, then sends it with the email', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    mockedRequest.mockResolvedValue({ ok: true });
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    await typeEmail();
    expect(sendButton()).toBeDisabled();

    turnstile.pass();
    expect(sendButton()).toBeEnabled();
    await userEvent.click(sendButton());

    expect(mockedRequest).toHaveBeenCalledWith({
      email: 'me@example.com',
      callbackUrl: '/',
      turnstileToken: TOKEN,
    });
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument();
  });

  it('waits again once the token expires', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    turnstile.pass();
    expect(sendButton()).toBeEnabled();
    turnstile.expire();
    expect(sendButton()).toBeDisabled();
  });

  it('asks to complete the check when the server refuses the token, and fetches a fresh one', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    mockedRequest.mockResolvedValue({ ok: false, error: 'challenge' });
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    await typeEmail();
    turnstile.pass();
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(CHALLENGE_FAILED_MESSAGE);
    expect(screen.queryByText(/check your email/i)).toBeNull();
    // A token passes one check: the spent one is dropped and a new one asked for.
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');
    expect(sendButton()).toBeDisabled();
  });

  it('fetches a fresh token after a failed send too', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    mockedRequest.mockResolvedValue({ ok: false, error: 'send_failed' });
    render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    await typeEmail();
    turnstile.pass();
    await userEvent.click(sendButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't send your magic link/i);
    expect(turnstile.api.reset).toHaveBeenCalledWith('widget-1');
  });

  it('removes the widget when the form goes away', async () => {
    const turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
    const { unmount } = render(<SignInForm turnstileSiteKey={SITE_KEY} />);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());

    unmount();
    expect(turnstile.api.remove).toHaveBeenCalledWith('widget-1');
  });
});

// The page decides whether the widget is shown, per request, from the same
// reading of the environment the server action checks tokens against.
describe('the sign-in page', () => {
  afterEach(() => vi.unstubAllEnvs());

  async function renderPageCountingWidgetScripts() {
    const page = await SignInPage();
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
