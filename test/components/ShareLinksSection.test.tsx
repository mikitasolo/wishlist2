// @vitest-environment jsdom
// The People tab's Share links section (WIS-335): rows, a failed read,
// revoking, an archived list's read-only section, and QR codes (WIS-328).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import ShareLinksSection, {
  EMPTY_SHARE_LINKS_TEXT,
  REVOKE_LINK_MESSAGE,
} from '@/components/ShareLinksSection';
import type { ShareLinkRow, ShareLinksControl } from '@/lib/hooks/useShareLinks';
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
  create: vi.fn().mockResolvedValue(null),
  update: vi.fn().mockResolvedValue(true),
  revoke: vi.fn().mockResolvedValue(true),
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
    expect(within(section).getByText(/Expires .* · 3 people joined/)).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Copy link Family chat' }));
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

  it('confirms a revoke, saying what stays, before revoking', async () => {
    const user = userEvent.setup();
    const c = control({ links: [row()] });
    renderSection(c);
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    await user.click(screen.getByRole('menuitem', { name: 'Revoke' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Revoke “Family chat”?');
    expect(dialog).toHaveTextContent(REVOKE_LINK_MESSAGE);
    expect(c.revoke).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Revoke link' }));
    expect(c.revoke).toHaveBeenCalledWith('l1');
  });

  it('keeps an archived list’s section to Edit and Revoke, with no New link', async () => {
    const user = userEvent.setup();
    renderSection(control({ links: [row()] }), true);
    expect(screen.queryByRole('button', { name: 'New link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy link Family chat' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Edit', 'Revoke']);
    expect(screen.queryByRole('menuitem', { name: 'QR code' })).toBeNull();
  });

  it('shows a live link’s QR code, encoding exactly its full /l/ URL', async () => {
    const user = userEvent.setup();
    renderSection(control({ links: [row()] }));
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    await user.click(screen.getByRole('menuitem', { name: 'QR code' }));
    const dialog = screen.getByRole('dialog', { name: 'QR code' });
    const qr = within(dialog).getByRole('img', { name: 'QR code for Family chat' });
    const url = `${window.location.origin}/l/${TOKEN}`;
    expect(qr.querySelector('path')).toHaveAttribute('d', qrShape(url).path);
    // The print card carries the list's name and the same code.
    const card = screen.getByTestId('qr-print-card');
    expect(card).toHaveTextContent('Anna’s birthday');
    expect(card).toHaveTextContent(url);
    expect(card.querySelector('path')).toHaveAttribute('d', qrShape(url).path);
  });

  it('offers no QR code for an expired link', async () => {
    const user = userEvent.setup();
    renderSection(
      control({
        links: [row({ expiresAt: new Date(2026, 4, 1).toISOString(), state: 'expired' })],
      })
    );
    await user.click(screen.getByRole('button', { name: 'Actions for Family chat' }));
    expect(screen.queryByRole('menuitem', { name: 'QR code' })).toBeNull();
  });

  it('creates a “Printed card” link with Create for print and opens its QR code', async () => {
    const user = userEvent.setup();
    const PRINT_TOKEN = 'PrintPrintPrintPrint12';
    const create = vi
      .fn()
      .mockResolvedValue(row({ _id: 'l9', label: 'Printed card', token: PRINT_TOKEN }));
    renderSection(control({ create }));
    await user.click(screen.getByRole('button', { name: 'New link' }));
    await user.click(screen.getByRole('button', { name: 'Create for print' }));
    expect(create).toHaveBeenCalledWith({ level: 'view', label: 'Printed card', expiresAt: null });
    const dialog = await screen.findByRole('dialog', { name: 'QR code' });
    expect(screen.queryByRole('dialog', { name: 'New link' })).toBeNull();
    const qr = within(dialog).getByRole('img', { name: 'QR code for Printed card' });
    expect(qr.querySelector('path')).toHaveAttribute(
      'd',
      qrShape(`${window.location.origin}/l/${PRINT_TOKEN}`).path
    );
  });

  it('opens no QR code when Create for print fails', async () => {
    const user = userEvent.setup();
    const c = control();
    renderSection(c);
    await user.click(screen.getByRole('button', { name: 'New link' }));
    await user.click(screen.getByRole('button', { name: 'Create for print' }));
    expect(c.create).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New link' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'QR code' })).toBeNull();
  });
});
