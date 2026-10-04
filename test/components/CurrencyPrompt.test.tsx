// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { push, showToast, update, auth } = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
  update: vi.fn(),
  // Mutable per test: the session's status and the user it names.
  auth: {
    status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading',
    defaultCurrency: 'USD' as string | undefined,
    currencyChosen: false,
  },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data:
      auth.status === 'authenticated'
        ? {
            user: {
              id: 'me',
              email: 'me@example.com',
              username: 'me',
              defaultCurrency: auth.defaultCurrency,
              currencyChosen: auth.currencyChosen,
            },
          }
        : null,
    status: auth.status,
    update,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import CurrencyPromptRow, { useCurrencyOffer } from '@/components/CurrencyPrompt';

/** The prompt as the dashboard's Needs you shows it: the row, whenever there's an offer. */
function CurrencyPrompt() {
  const offer = useCurrencyOffer();
  return offer ? <CurrencyPromptRow offer={offer} /> : null;
}

type Reply = { status: number; body: unknown } | Error;
let patchReply: Reply;
/** Resolves the PATCH in flight, for tests that look at the prompt meanwhile. */
let holdPatch: Promise<void> | null;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (url === '/api/users/me' && init?.method === 'PATCH') {
    if (holdPatch) await holdPatch;
    if (patchReply instanceof Error) throw patchReply;
    const { status, body } = patchReply;
    return { ok: status < 400, status, json: async () => body };
  }
  throw new Error(`unexpected fetch ${url}`);
});
const patches = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init!.body)));

/** What the browser says about where it is: set with `browserAt`. */
const browser = { timeZone: 'Europe/Warsaw', language: 'en-US' };
function browserAt(timeZone: string, language = 'en-US') {
  browser.timeZone = timeZone;
  browser.language = language;
}
const realResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;

const prompt = () => screen.queryByRole('region', { name: /Show prices in/ });
const useButton = (code: string) => screen.getByRole('button', { name: `Use ${code}` });
const keepUsd = () => screen.getByRole('button', { name: 'Keep USD' });
const otherCurrency = () => screen.getByRole('combobox', { name: 'Other currency' });

beforeEach(() => {
  cleanup();
  push.mockReset();
  showToast.mockReset();
  update.mockReset().mockResolvedValue(null);
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
  auth.status = 'authenticated';
  auth.defaultCurrency = 'USD';
  auth.currencyChosen = false;
  patchReply = { status: 200, body: { success: true, data: {} } };
  holdPatch = null;
  browserAt('Europe/Warsaw');
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat
  ) {
    return { ...realResolvedOptions.call(this), timeZone: browser.timeZone };
  });
  vi.spyOn(navigator, 'language', 'get').mockImplementation(() => browser.language);
});
afterEach(() => vi.restoreAllMocks());

describe('CurrencyPrompt', () => {
  it('offers the browser’s currency to a new USD user', () => {
    render(<CurrencyPrompt />);

    expect(prompt()).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Show prices in PLN?' })).toBeInTheDocument();
    expect(screen.getByText(/Polish Zloty would be the default/)).toBeInTheDocument();
    expect(useButton('PLN')).toBeEnabled();
    expect(otherCurrency()).toBeEnabled();
    expect(keepUsd()).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('goes by the time zone, then by the language', () => {
    browserAt('Europe/Minsk', 'ru-RU');
    render(<CurrencyPrompt />);
    expect(screen.getByRole('heading', { name: 'Show prices in BYN?' })).toBeInTheDocument();

    cleanup();
    browserAt('UTC', 'en-GB');
    render(<CurrencyPrompt />);
    expect(screen.getByRole('heading', { name: 'Show prices in GBP?' })).toBeInTheDocument();
  });

  it('“Use PLN” saves it with the answer, goes, and refreshes the session', async () => {
    render(<CurrencyPrompt />);

    fireEvent.click(useButton('PLN'));

    expect(prompt()).not.toBeInTheDocument();
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(patches()).toEqual([{ defaultCurrency: 'PLN', currencyChosen: true }]);
    expect(showToast).toHaveBeenCalledWith('Prices will show in PLN', 'success');
    expect(push).not.toHaveBeenCalled();
    expect(prompt()).not.toBeInTheDocument();
  });

  it('picking another currency saves it with the answer, and stays on the page', async () => {
    render(<CurrencyPrompt />);

    fireEvent.click(otherCurrency());
    fireEvent.click(await screen.findByRole('option', { name: /^EUR/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(patches()).toEqual([{ defaultCurrency: 'EUR', currencyChosen: true }]);
    expect(showToast).toHaveBeenCalledWith('Prices will show in EUR', 'success');
    expect(push).not.toHaveBeenCalled();
    expect(prompt()).not.toBeInTheDocument();
  });

  it('“Keep USD” sends only the answer, and stays on the page', async () => {
    render(<CurrencyPrompt />);

    fireEvent.click(keepUsd());

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(patches()).toEqual([{ currencyChosen: true }]);
    expect(push).not.toHaveBeenCalled();
    expect(prompt()).not.toBeInTheDocument();
  });

  it('never shows once they’ve answered it', () => {
    auth.currencyChosen = true;
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();
  });

  it('never shows to someone who has already moved off USD', () => {
    auth.defaultCurrency = 'EUR';
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();

    cleanup();
    auth.defaultCurrency = 'PLN';
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();
  });

  // Offering the USD they already have would ask nothing, and records nothing.
  it('doesn’t show when the browser’s currency is USD, or unknown', () => {
    browserAt('America/New_York');
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();

    cleanup();
    browserAt('UTC', 'ru');
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();

    // Nor for a place whose currency the pickers don't offer.
    cleanup();
    browserAt('Europe/Kyiv', 'ru-RU');
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('doesn’t show without a session', () => {
    auth.status = 'loading';
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();

    cleanup();
    auth.status = 'unauthenticated';
    render(<CurrencyPrompt />);
    expect(prompt()).not.toBeInTheDocument();
  });

  it('comes back with the error when “Use PLN” can’t be saved', async () => {
    patchReply = { status: 400, body: { success: false, error: 'Invalid currency code' } };
    render(<CurrencyPrompt />);

    fireEvent.click(useButton('PLN'));

    expect(await screen.findByRole('region', { name: /Show prices in PLN/ })).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith('Invalid currency code', 'error');
    expect(update).not.toHaveBeenCalled();
    expect(useButton('PLN')).toBeEnabled();
  });

  it('comes back, with an error, when “Keep USD” can’t be saved', async () => {
    patchReply = new Error('offline');
    render(<CurrencyPrompt />);

    fireEvent.click(keepUsd());

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to save your currency choice', 'error')
    );
    expect(push).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(await screen.findByRole('region', { name: /Show prices in/ })).toBeInTheDocument();
    expect(keepUsd()).toBeEnabled();
  });

  it('sends one answer however fast it’s clicked', async () => {
    let release!: () => void;
    holdPatch = new Promise((resolve) => (release = resolve));
    render(<CurrencyPrompt />);

    const keep = keepUsd();
    const use = useButton('PLN');
    fireEvent.click(keep);
    fireEvent.click(keep);
    fireEvent.click(use);
    release();

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(patches()).toEqual([{ currencyChosen: true }]);
  });
});
