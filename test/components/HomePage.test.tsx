// @vitest-environment jsdom
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { SessionContext, useSession } from 'next-auth/react';
import type { Session } from 'next-auth';
import type { ComponentProps, ReactNode } from 'react';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('next-auth/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next-auth/react')>()),
  signIn,
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh }) }));
vi.mock('@/components/AppHeader', () => ({
  default: ({ actions }: { actions?: ReactNode }) => <header>{actions}</header>,
}));
vi.mock('@/components/AuthButton', () => ({ default: () => <button>Sign in</button> }));
// The dashboard, as far as the gate is concerned: who it thinks is signed in.
vi.mock('@/components/Dashboard', () => ({
  default: function Dashboard() {
    const { data, status } = useSession();
    return <p data-testid="dashboard">{`${status}:${data?.user?.id ?? 'none'}`}</p>;
  },
}));

import HomeGate from '@/components/HomeGate';
import Landing from '@/components/Landing';
import SeededSession from '@/components/SeededSession';

type Live = NonNullable<ComponentProps<typeof SessionContext.Provider>['value']>;

const update = vi.fn();
const ACCOUNT: Session = { user: { id: 'u1', email: 'me@example.com' }, expires: '2099-01-01' };
const OTHER: Session = { user: { id: 'u2', email: 'other@example.com' }, expires: '2099-01-01' };
// next-auth's provider before its first read: `data` undefined, not null.
const NEVER_READ = { data: undefined, status: 'loading', update } as unknown as Live;

/** As `app/page.tsx` renders it: the landing is only sent with no account. */
function home(live: Live, seeded: Session | null | undefined) {
  return render(
    <SessionContext.Provider value={live}>
      <SeededSession session={seeded}>
        <HomeGate landing={seeded ? null : <Landing />} />
      </SeededSession>
    </SessionContext.Provider>
  );
}

beforeEach(() => {
  refresh.mockReset();
  signIn.mockReset();
});

describe('the home page’s session', () => {
  it('shows the landing for a visitor the server read as signed out, before the browser’s read', () => {
    home(NEVER_READ, null);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Wishlists your friends can shop from — no spoilers, no duplicate gifts.'
    );
    expect(screen.queryByTestId('dashboard')).toBeNull();
  });

  it('shows the dashboard, signed in, for an account the server read', () => {
    home(NEVER_READ, ACCOUNT);
    expect(screen.getByTestId('dashboard')).toHaveTextContent('authenticated:u1');
  });

  it('waits for the browser’s read when the server couldn’t tell', () => {
    home(NEVER_READ, undefined);
    expect(screen.getByTestId('dashboard')).toHaveTextContent('loading:none');
  });

  it('follows the live session once it has been read, over what the server said', () => {
    home({ data: OTHER, status: 'authenticated', update }, ACCOUNT);
    expect(screen.getByTestId('dashboard')).toHaveTextContent('authenticated:u2');
  });

  it('shows the landing once the live session says signed out', () => {
    home({ data: null, status: 'unauthenticated', update }, undefined);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  // The server sends no landing to an account: a session that ends without a
  // reload (signed out in another tab) asks the server for the page again.
  it('asks the server for the landing when an account’s session ends in place', () => {
    home({ data: null, status: 'unauthenticated', update }, ACCOUNT);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('dashboard')).toHaveTextContent('unauthenticated:none');
  });

  // An `update()` puts next-auth's session back through loading, keeping the
  // session it had: that one stands, not the page's older server read.
  it('keeps the live session through an update', () => {
    home({ data: OTHER, status: 'loading', update } as unknown as Live, ACCOUNT);
    expect(screen.getByTestId('dashboard')).toHaveTextContent('loading:u2');
  });
});

describe('the landing', () => {
  it('has one call to action, Create your wishlist, with the search directly under it', () => {
    home({ data: null, status: 'unauthenticated', update }, null);
    const main = screen.getByRole('main');
    const buttons = within(main).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const cta = buttons[0];
    expect(cta).toHaveAccessibleName('Create your wishlist');

    // The CTA's own row, then the search's block right after it.
    const ctaRow = cta.closest('[data-testid="landing-cta"]') as HTMLElement;
    const next = ctaRow.nextElementSibling as HTMLElement;
    expect(next).toHaveTextContent('Looking for someone’s list? Search by username');
    expect(
      within(next).getByRole('combobox', { name: 'Search people and wishlists' })
    ).toBeInTheDocument();

    cta.click();
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('keeps the header’s Sign in, and drops the old Get started and Sign in / Sign up', () => {
    home({ data: null, status: 'unauthenticated', update }, null);
    expect(
      within(screen.getByRole('banner')).getByRole('button', { name: 'Sign in' })
    ).toBeVisible();
    expect(screen.queryByText(/Get started/)).toBeNull();
    expect(screen.queryByText(/Sign in \/ Sign up/)).toBeNull();
  });

  it('shows the item reserved only in the friends’ view of the mock', () => {
    home({ data: null, status: 'unauthenticated', update }, null);
    const [owner, friends] = screen.getAllByRole('figure');
    expect(owner).toHaveTextContent('Ceramic pour-over set');
    expect(within(owner).queryByText('Reserved')).toBeNull();
    expect(friends).toHaveTextContent('Ceramic pour-over set');
    expect(within(friends).getByText('Reserved')).toBeInTheDocument();
  });
});
