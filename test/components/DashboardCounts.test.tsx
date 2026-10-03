// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', username: 'me' } },
    status: 'authenticated',
  }),
  signIn: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The header and the dialogs have their own fetches and tests; this file is
// about the numbers at the top of the dashboard.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/GlobalSearch', () => ({ default: () => null }));
vi.mock('@/components/CreateWishlistModal', () => ({ default: () => null }));
vi.mock('@/components/FollowListModal', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import Home from '@/app/page';
import { atWidth } from './viewport';

function list(id: string, fields: Record<string, unknown>) {
  return {
    _id: id,
    slug: id,
    name: id,
    visibility: 'everyone',
    owners: ['me'],
    featured: false,
    occasion: null,
    ...fields,
  };
}

// Two active lists of your own (5 published items between them, 3 drafts and 2
// proposals), an archived one, and two lists shared with you. The archived and
// shared lists' items aren't "in your lists".
let owned: unknown[];
let member: unknown[];

function json(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  // Desktop width: the lists are cards (a phone gets rows, `WishlistList.test.tsx`).
  atWidth(1280);
  owned = [
    list('birthday', { itemCount: 3, draftCount: 1, proposalCount: 2 }),
    list('flat', { itemCount: 2, draftCount: 2, proposalCount: 0 }),
    list('old', { archived: true, itemCount: 9, draftCount: 4, proposalCount: 1 }),
  ];
  member = [
    list('anna', { owners: ['anna'], itemCount: 7, isMember: true }),
    list('dmitri', { owners: ['dmitri'], itemCount: 4, isMember: true }),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/wishlists') return json({ success: true, data: { owned, member } });
      if (url === '/api/users/me/reservations/count') {
        return json({ success: true, data: { count: 0 } });
      }
      if (url === '/api/users/me') {
        return json({ success: true, data: { _id: 'me', followerCount: 0, followingCount: 0 } });
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const tile = (name: RegExp) => screen.findByRole('link', { name });
const tileValue = async (name: RegExp) =>
  (await tile(name)).querySelector('.text-3xl')?.textContent ?? null;

describe('dashboard — the greeting and the tiles', () => {
  // regression: the greeting counted the archived and shared lists too ("5
  // lists"), while the tiles beside it counted your active lists (2) and the
  // shared ones (2) apart.
  it('regression: count the same lists and the same items', async () => {
    render(<Home />);

    expect(
      await screen.findByText('2 lists · 5 items in your lists', { selector: 'p' })
    ).toBeInTheDocument();
    expect(await tileValue(/Your wishlists/)).toBe('2');
    expect(await tileValue(/Items in your lists/)).toBe('5');
    expect(await tileValue(/Shared with you/)).toBe('2');
  });

  it('shows the drafts and proposals to review beside the items, on your own lists only', async () => {
    render(<Home />);

    const items = await tile(/Items in your lists/);
    expect(within(items).getByText('3 drafts · 2 to review')).toBeInTheDocument();
    // On your own cards too, and never on a list shared with you.
    expect(screen.getByText('3 items · 1 draft · 2 to review')).toBeInTheDocument();
    expect(screen.getByText('2 items · 2 drafts')).toBeInTheDocument();
    expect(screen.getByText('7 items')).toBeInTheDocument();
    expect(screen.getByText('4 items')).toBeInTheDocument();
  });

  it('counts nothing when you have no list of your own, only shared ones', async () => {
    owned = [];
    render(<Home />);

    expect(
      await screen.findByText('Let’s create your first wishlist.', { selector: 'p' })
    ).toBeInTheDocument();
    expect(await tileValue(/Your wishlists/)).toBe('0');
    expect(await tileValue(/Items in your lists/)).toBe('0');
    expect(await tileValue(/Shared with you/)).toBe('2');
  });

  it('counts nothing when all your lists are archived', async () => {
    owned = [list('old', { archived: true, itemCount: 9, draftCount: 4, proposalCount: 1 })];
    render(<Home />);

    expect(
      await screen.findByText('Let’s create a new wishlist.', { selector: 'p' })
    ).toBeInTheDocument();
    expect(await tileValue(/Your wishlists/)).toBe('0');
    expect(await tileValue(/Items in your lists/)).toBe('0');
  });

  it('shows nothing beside the items when there are no drafts or proposals', async () => {
    owned = [list('birthday', { itemCount: 1, draftCount: 0, proposalCount: 0 })];
    render(<Home />);

    expect(
      await screen.findByText('1 list · 1 item in your lists', { selector: 'p' })
    ).toBeInTheDocument();
    const items = await tile(/Items in your lists/);
    expect(within(items).queryByText(/draft|review/)).toBeNull();
  });
});
