// @vitest-environment jsdom
// The items page's status filter (its stat cards and Status dropdown) starts on
// All every visit, as the wishlist page's starts on its defaults, and never
// holds an empty selection. Its sort is still remembered.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

const { router, showToast } = vi.hoisted(() => ({
  router: { push: vi.fn() },
  showToast: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'carol', username: 'carol' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import MyItemsPage from '@/app/items/page';

const item = (name: string, status: string, day: number) => ({
  _id: name,
  name,
  imageUrl: null,
  price: null,
  priceInUsdCents: null,
  link: null,
  mostWanted: false,
  status,
  wishlistId: 'w1',
  wishlistSlug: 'birthday',
  wishlistName: 'Birthday',
  createdAt: `2026-01-0${day}T00:00:00.000Z`,
});

// Newest first, the page's default sort.
const ALL = ['Vase', 'Idea', 'Sketch', 'Lamp'];

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url !== '/api/users/me/items') throw new Error(`unexpected fetch ${url}`);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: [
            item('Lamp', 'available', 1),
            item('Sketch', 'draft', 2),
            item('Idea', 'proposed', 3),
            item('Vase', 'completed', 4),
          ],
        }),
      };
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The item cards' names, in order. */
const shown = () =>
  Array.from(document.querySelectorAll('main p.font-semibold'), (p) => p.textContent);
const statusDropdown = () => screen.getByRole('button', { name: 'Filter by status' });
const card = (label: string) =>
  screen.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) });

async function visit() {
  const view = render(<MyItemsPage />);
  await screen.findByText('Lamp');
  return view;
}

describe('/items status filter', () => {
  // regression: the status filter was saved (items-status-filters), so a stat
  // card clicked once narrowed the page on every later visit.
  it('regression: starts on All on the next visit, whatever was picked on the last', async () => {
    const user = userEvent.setup();
    const first = await visit();
    expect(shown()).toEqual(ALL);

    await user.click(card('Completed'));
    expect(shown()).toEqual(['Vase']);

    first.unmount();
    await visit();

    expect(shown()).toEqual(ALL);
    expect(statusDropdown()).toHaveTextContent('All');
    expect(localStorage.getItem('items-status-filters')).toBeNull();
  });

  it('regression: ignores and deletes a status filter an earlier version saved', async () => {
    localStorage.setItem('items-status-filters', JSON.stringify(['draft']));
    await visit();
    expect(shown()).toEqual(ALL);
    expect(localStorage.getItem('items-status-filters')).toBeNull();
  });

  it('remembers the sort', async () => {
    const user = userEvent.setup();
    const first = await visit();
    await user.click(screen.getByRole('combobox', { name: 'Sort items' }));
    await user.click(screen.getByRole('option', { name: 'Name (A-Z)' }));
    expect(shown()).toEqual(['Idea', 'Lamp', 'Sketch', 'Vase']);

    first.unmount();
    await visit();

    expect(shown()).toEqual(['Idea', 'Lamp', 'Sketch', 'Vase']);
  });

  // regression: unticking the last option, or All, left "None selected" (and
  // nothing shown). Every status is the page's default, so it's All instead.
  it('regression: goes back to All when the last option ticked is unticked', async () => {
    const user = userEvent.setup();
    await visit();
    await user.click(card('Draft'));
    expect(shown()).toEqual(['Sketch']);

    await user.click(statusDropdown());
    await user.click(screen.getByRole('checkbox', { name: 'Draft' }));

    expect(shown()).toEqual(ALL);
    expect(statusDropdown()).toHaveTextContent('All');
    expect(screen.queryByText('None selected')).toBeNull();
  });

  it('regression: keeps showing everything when All is unticked', async () => {
    const user = userEvent.setup();
    await visit();
    await user.click(statusDropdown());
    await user.click(screen.getByRole('checkbox', { name: 'All' }));

    expect(shown()).toEqual(ALL);
    expect(statusDropdown()).toHaveTextContent('All');
    expect(screen.queryByText('None selected')).toBeNull();
  });
});
