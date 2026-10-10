// @vitest-environment jsdom
// The People tab's Share links section (WIS-335): rows, a failed read,
// revoking, an archived list's read-only section, and each link's dialog
// with its URL and QR code (WIS-328, WIS-341).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, act, renderHook, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import ShareLinksSection, { EMPTY_SHARE_LINKS_TEXT } from '@/components/ShareLinksSection';
import {
  useShareLinks,
  type ShareLinkRow,
  type ShareLinksControl,
} from '@/lib/hooks/useShareLinks';
import { UNDO_WINDOW_MS } from '@/lib/utils/deferredCommit';
import { qrShape } from '@/lib/utils/qrCode';

beforeEach(() => showToast.mockReset());
afterEach(() => cleanup());

const now = new Date(2026, 5, 1, 15, 30);
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

const row = (over: Partial<ShareLinkRow> = {}): ShareLinkRow => ({
  _id: 'l1',
  level: 'view',
  label: 'Family chat',
  expiresAt: null,
  untilOccasion: false,
  createdAt: now.toISOString(),
  state: 'live',
  joinedCount: 0,
  token: TOKEN,
  ...over,
});

const control = (over: Partial<ShareLinksControl> = {}): ShareLinksControl => ({
  read: 'loaded',
  links: [],
  liveCount: 0,
  retry: vi.fn(),
  reload: vi.fn(),
  create: vi.fn().mockResolvedValue(null),
  update: vi.fn().mockResolvedValue(true),
  revoke: vi.fn().mockResolvedValue(true),
  revokeWithUndo: vi.fn(),
  ...over,
});

function renderSection(c: ShareLinksControl, archived = false) {
  render(
    <ShareLinksSection
      control={c}
      listName="Anna’s birthday"
      archived={archived}
      visibility="private"
      now={now}
    />
  );
}

describe('ShareLinksSection', () => {
  it('lists each link with its level, expiry and joined count', () => {
    renderSection(
      control({
        links: [
          row(),
          row({
            _id: 'l2',
            level: 'join',
            label: null,
            joinedCount: 3,
            expiresAt: new Date(2026, 5, 13).toISOString(),
          }),
          row({
            _id: 'l3',
            label: 'Old QR',
            expiresAt: new Date(2026, 4, 1).toISOString(),
            state: 'expired',
          }),
        ],
      })
    );
    const section = screen.getByRole('region', { name: 'Share links' });
    expect(within(section).getByText('Family chat')).toBeInTheDocument();
    expect(within(section).getAllByText('Can view')).toHaveLength(2);
    expect(within(section).getByText('Untitled link')).toBeInTheDocument();
    expect(within(section).getByText('Can join')).toBeInTheDocument();
    const meta = within(section).getByText(/Expires .* · 3 people joined/);
    // regression (WIS-341): on a phone the meta line was cut to "0 p…"; it wraps instead.
    expect(meta.className).not.toMatch(/\btruncate\b/);
    expect(within(section).getByText('Expired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New link' })).toBeInTheDocument();
  });

  it('shows a failed read as a load error with Try again, never as no links', async () => {
    const user = userEvent.setup();
    const c = control({ read: 'failed' });
    renderSection(c);
    expect(screen.getByText('Couldn’t load this list’s share links')).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_SHARE_LINKS_TEXT)).toBeNull();
    expect(screen.queryByRole('button', { name: 'New link' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(c.retry).toHaveBeenCalled();
  });

  it('says when there are no links yet', () => {
    renderSection(control());
    expect(screen.getByText(EMPTY_SHARE_LINKS_TEXT)).toBeInTheDocument();
  });

  it('copies a link’s full URL', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderSection(control({ links: [row()] }));
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/l/${TOKEN}`);
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');
  });

  it('offers a preview as a visitor for a live link', async () => {
    const user = userEvent.setup();
    renderSection(control({ links: [row()] }));
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    expect(screen.getByRole('menuitem', { name: /Preview as visitor/ })).toHaveAttribute(
      'href',
      `/l/${TOKEN}?as=visitor`
    );
  });

  it('revokes with Undo instead of a confirmation (WIS-387)', async () => {
    const user = userEvent.setup();
    const c = control({ links: [row()] });
    renderSection(c);
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(c.revokeWithUndo).toHaveBeenCalledWith('l1');
    expect(c.revoke).not.toHaveBeenCalled();
  });

  it('keeps an archived list’s section to Edit and Revoke, with no New link or Share', async () => {
    const user = userEvent.setup();
    renderSection(control({ links: [row()] }), true);
    expect(screen.queryByRole('button', { name: 'New link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share Family chat' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Revoke']);
  });

  it('keeps an expired link to Edit and Revoke, with no Share', async () => {
    const user = userEvent.setup();
    renderSection(
      control({
        links: [row({ expiresAt: new Date(2026, 4, 1).toISOString(), state: 'expired' })],
      })
    );
    expect(screen.queryByRole('button', { name: 'Share Family chat' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Revoke']);
  });

  it('opens a live link’s dialog from Share, with exactly its full /l/ URL and QR code', async () => {
    const user = userEvent.setup();
    renderSection(control({ links: [row()] }));
    await user.click(screen.getByRole('button', { name: 'Share Family chat' }));
    const dialog = screen.getByRole('dialog', { name: 'Family chat' });
    const url = `${window.location.origin}/l/${TOKEN}`;
    expect(within(dialog).getByLabelText('Link')).toHaveValue(url);
    const preview = within(dialog).getByRole('img', { name: 'Card preview for Family chat' });
    expect(preview.querySelector('[data-qr] path')).toHaveAttribute('d', qrShape(url).path);
    // The print card carries the list's name and the same code.
    const card = screen.getByTestId('qr-print-card');
    expect(card).toHaveTextContent(/Anna’s ?birthday/);
    expect(card).toHaveTextContent(url);
    expect(card.querySelector('[data-qr] path')).toHaveAttribute('d', qrShape(url).path);
  });

  it('opens a new link in its dialog as soon as it’s created, with the label typed', async () => {
    const user = userEvent.setup();
    const NEW_TOKEN = 'NewNewNewNewNewNewNew1';
    const create = vi
      .fn()
      .mockResolvedValue(row({ _id: 'l9', label: 'Wedding QR', token: NEW_TOKEN }));
    renderSection(control({ create }));
    await user.click(screen.getByRole('button', { name: 'New link' }));
    await user.type(screen.getByLabelText('Label', { exact: false }), 'Wedding QR');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(create).toHaveBeenCalledWith({ level: 'view', label: 'Wedding QR', expiresAt: null });
    const dialog = await screen.findByRole('dialog', { name: 'Wedding QR' });
    expect(screen.queryByRole('dialog', { name: 'New link' })).toBeNull();
    const url = `${window.location.origin}/l/${NEW_TOKEN}`;
    expect(within(dialog).getByLabelText('Link')).toHaveValue(url);
    expect(
      within(dialog)
        .getByRole('img', { name: 'Card preview for Wedding QR' })
        .querySelector('[data-qr] path')
    ).toHaveAttribute('d', qrShape(url).path);
  });

  it('opens nothing when the create fails, and keeps New link open', async () => {
    const user = userEvent.setup();
    const c = control();
    renderSection(c);
    await user.click(screen.getByRole('button', { name: 'New link' }));
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(c.create).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New link' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

// WIS-387: a row's Revoke goes from the list at once, and the DELETE only once
// the Undo window has passed; undone, the link never stopped working.
describe('useShareLinks revokeWithUndo', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      Response.json(
        init?.method === 'DELETE' ? { success: true } : { success: true, data: [row()] }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const deletes = () =>
    fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE'
    );

  async function loaded() {
    const hook = renderHook(() => useShareLinks('w1', true));
    await waitFor(() => expect(hook.result.current.links).toHaveLength(1));
    vi.useFakeTimers();
    return hook;
  }

  it('hides the link at once and revokes it after the Undo window', async () => {
    const { result } = await loaded();
    act(() => result.current.revokeWithUndo('l1'));
    expect(result.current.links).toEqual([]);
    expect(result.current.liveCount).toBe(0);
    expect(showToast).toHaveBeenCalledWith(
      'Link revoked',
      'success',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
    );
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
    });
    expect(deletes()).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {});
    expect(deletes()).toEqual([
      ['/api/wishlists/w1/links/l1', expect.objectContaining({ method: 'DELETE' })],
    ]);
    expect(result.current.links).toEqual([]);
  });

  it('sends nothing and brings the link back when undone', async () => {
    const { result } = await loaded();
    act(() => result.current.revokeWithUndo('l1'));
    const options = showToast.mock.calls.at(-1)![2];
    await act(async () => options.action.onClick());
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS * 3);
    });
    expect(deletes()).toHaveLength(0);
    expect(result.current.links.map((l) => l._id)).toEqual(['l1']);
  });

  it('brings the link back when the revoke fails', async () => {
    const { result } = await loaded();
    fetchMock.mockImplementation(async () =>
      Response.json({ success: false, error: 'Nope' }, { status: 500 })
    );
    act(() => result.current.revokeWithUndo('l1'));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_WINDOW_MS);
    });
    await act(async () => {});
    await act(async () => {});
    expect(showToast).toHaveBeenCalledWith('Nope', 'error');
    expect(result.current.links.map((l) => l._id)).toEqual(['l1']);
  });
});
