// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const { replace, flow, session } = vi.hoisted(() => ({
  replace: vi.fn(),
  flow: vi.fn(),
  session: { status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data:
      session.status === 'authenticated' ? { user: { id: 'me', defaultCurrency: 'EUR' } } : null,
    status: session.status,
    update: vi.fn(),
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/AddFromLinkFlow', () => ({
  default: (props: unknown) => {
    flow(props);
    return <div data-testid="flow" />;
  },
}));

import NewItemFromLinkPage from '@/app/items/new/page';

const HASH = '#name=Mug&price=9.99&currency=EUR&link=https%3A%2F%2Fshop.example.com%2Fp';

beforeEach(() => {
  replace.mockReset();
  flow.mockReset();
  session.status = 'authenticated';
  window.history.replaceState(null, '', '/items/new');
});
afterEach(cleanup);

describe('/items/new', () => {
  it('reads the product from the fragment, hands it to the flow, and strips it from the address', async () => {
    window.history.replaceState(null, '', `/items/new${HASH}`);
    render(<NewItemFromLinkPage />);

    await waitFor(() => expect(flow).toHaveBeenCalled());
    expect(flow).toHaveBeenLastCalledWith({
      product: {
        name: 'Mug',
        price: { value: 999, currency: 'EUR' },
        link: 'https://shop.example.com/p',
      },
      userCurrency: 'EUR',
    });
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/items/new');
  });

  it('opens the plain flow, with no error, for an empty or garbage fragment', async () => {
    window.history.replaceState(null, '', '/items/new#%%%garbage');
    render(<NewItemFromLinkPage />);
    await waitFor(() => expect(flow).toHaveBeenCalled());
    expect(flow.mock.lastCall?.[0]).toMatchObject({ product: null });
  });

  it('keeps the query string when it strips the fragment', async () => {
    window.history.replaceState(null, '', `/items/new?x=1${HASH}`);
    render(<NewItemFromLinkPage />);
    await waitFor(() => expect(flow).toHaveBeenCalled());
    expect(window.location.search).toBe('?x=1');
    expect(window.location.hash).toBe('');
  });

  // regression: sign-in dropped everything after the path, so a visitor who had
  // to sign in lost the product the bookmarklet had read.
  it('sends a signed-out visitor to sign in with the fragment kept in the callback', async () => {
    session.status = 'unauthenticated';
    window.history.replaceState(null, '', `/items/new${HASH}`);
    render(<NewItemFromLinkPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(
      `/auth/signin?callbackUrl=${encodeURIComponent(`/items/new${HASH}`)}`
    );
    expect(flow).not.toHaveBeenCalled();
    // Still in the address, for the sign-in to carry.
    expect(window.location.hash).toBe(HASH);
  });

  it('waits for the session before reading anything', () => {
    session.status = 'loading';
    window.history.replaceState(null, '', `/items/new${HASH}`);
    render(<NewItemFromLinkPage />);
    expect(flow).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe(HASH);
  });
});
