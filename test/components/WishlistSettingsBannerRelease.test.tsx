// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// WIS-181: a cover photo uploaded in a list's Settings that no save took is
// handed back to DELETE /api/upload when it's replaced, when Discard puts the
// form back, and when the page goes. One a save took, or may have, stays.

const { push, replace, showToast, upload } = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  showToast: vi.fn(),
  upload: { n: 0 },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'alice', username: 'alice' } },
    status: 'authenticated',
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useParams: () => ({ id: 'birthday' }),
}));
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
// Hands its form's unsaved uploads what the real one does.
vi.mock('@/components/ImageUpload', () => ({
  default: ({
    value,
    onChange,
    uploads,
  }: {
    value: string | null;
    onChange: (url: string | null) => void;
    uploads?: import('@/lib/utils/freshUploads').FreshUploads;
  }) => (
    <div data-testid="banner" data-value={value ?? ''}>
      <button
        type="button"
        onClick={() => {
          const url = `${STORE}/banner-${++upload.n}.webp`;
          if (uploads && !uploads.add(url)) return;
          uploads?.discard(value);
          onChange(url);
        }}
      >
        Finish upload
      </button>
    </div>
  ),
}));

import WishlistDetail from '@/app/wishlists/[id]/page';
import { openListTab } from './listMenu';

const STORE = 'https://teststore42.public.blob.vercel-storage.com/uploads/alice';
const SAVED_BANNER = `${STORE}/saved.webp`;

const loaded = {
  _id: 'birthday',
  name: 'Birthday',
  slug: 'birthday',
  description: 'Things I would like',
  owners: ['alice'],
  visibility: 'everyone',
  archived: false,
  featured: false,
  currency: 'EUR',
  bannerUrl: SAVED_BANNER,
  occasion: null,
};

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

let server: typeof loaded & Record<string, unknown>;
let released: string[];
let patchAnswer: 'ok' | 'refused' | 'network';
const fetchMock = vi.fn();

beforeEach(() => {
  upload.n = 0;
  released = [];
  patchAnswer = 'ok';
  server = { ...loaded };
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/upload' && method === 'DELETE') {
      released.push(JSON.parse(String(init?.body)).url);
      return reply({ success: true });
    }
    if (url === '/api/wishlists/birthday' && method === 'GET') {
      return reply({
        success: true,
        data: { ...server, userRole: 'owner', ownerUsernames: ['alice'] },
      });
    }
    if (url === '/api/wishlists/birthday' && method === 'PATCH') {
      if (patchAnswer === 'network') throw new TypeError('Failed to fetch');
      if (patchAnswer === 'refused') {
        return reply({ success: false, error: 'You can only use images you uploaded' }, 400);
      }
      server = { ...server, ...JSON.parse(String(init?.body)) };
      return reply({ success: true, data: server });
    }
    if (url.startsWith('/api/wishlists/birthday/')) return reply({ success: true, data: [] });
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSettings() {
  const user = userEvent.setup();
  render(<WishlistDetail />);
  await openListTab(user, 'Settings');
  await screen.findByRole('heading', { name: 'About' });
  return user;
}

const banner = () => screen.getByTestId('banner').getAttribute('data-value');
const saveBar = () => screen.queryByText('Unsaved changes')?.parentElement ?? null;

describe("a list's cover photo no save took", () => {
  it('is handed back when replaced, and on Discard, never the saved one', async () => {
    const user = await openSettings();
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    expect(banner()).toBe(`${STORE}/banner-2.webp`);
    expect(released).toEqual([`${STORE}/banner-1.webp`]);

    await user.click(within(saveBar()!).getByRole('button', { name: 'Discard' }));
    expect(banner()).toBe(SAVED_BANNER);
    expect(released).toEqual([`${STORE}/banner-1.webp`, `${STORE}/banner-2.webp`]);
    cleanup();
    expect(released).toHaveLength(2);
  });

  it('is kept once a save took it, when the page is left', async () => {
    const user = await openSettings();
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await user.click(within(saveBar()!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.bannerUrl).toBe(`${STORE}/banner-1.webp`));
    await waitFor(() => expect(saveBar()).toBeNull());
    cleanup();
    expect(released).toEqual([]);
  });

  it('stays in the form after a refused save, and is handed back when the page is left', async () => {
    const user = await openSettings();
    patchAnswer = 'refused';
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await user.click(within(saveBar()!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(banner()).toBe(`${STORE}/banner-1.webp`);
    expect(released).toEqual([]);
    cleanup();
    expect(released).toEqual([`${STORE}/banner-1.webp`]);
  });

  it('is kept after a save with no answer, since it may have landed', async () => {
    const user = await openSettings();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    patchAnswer = 'network';
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await user.click(within(saveBar()!).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(showToast).toHaveBeenCalled());
    await user.click(within(saveBar()!).getByRole('button', { name: 'Discard' }));
    cleanup();
    expect(released).toEqual([]);
    consoleError.mockRestore();
  });
});
