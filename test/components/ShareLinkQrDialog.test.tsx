// @vitest-environment jsdom
// A share link's QR code (WIS-328): the warning for its level, the SVG
// download, and the print card with the list's name and occasion.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/hooks/useLocalToday', () => ({ useLocalToday: () => '2026-06-01' }));

import ShareLinkQrDialog, { PRINT_CARD_CALLS, QR_WARNINGS } from '@/components/ShareLinkQrDialog';
import type { ShareLinkRow } from '@/lib/hooks/useShareLinks';
import { qrShape, qrSvgFile } from '@/lib/utils/qrCode';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const URL_ = `${window.location.origin}/l/${TOKEN}`;

const link = (over: Partial<ShareLinkRow> = {}): ShareLinkRow & { token: string } => ({
  _id: 'l1',
  level: 'view',
  label: 'Wedding QR',
  expiresAt: null,
  createdAt: new Date(2026, 5, 1).toISOString(),
  state: 'live',
  joinedCount: 0,
  token: TOKEN,
  ...over,
});

beforeEach(() => showToast.mockReset());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ShareLinkQrDialog', () => {
  it('warns that anyone who scans a View link can see the list', () => {
    render(<ShareLinkQrDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'QR code' })).toHaveTextContent(QR_WARNINGS.view);
    expect(screen.getByTestId('qr-print-card')).toHaveTextContent(PRINT_CARD_CALLS.view);
  });

  it('warns that anyone who scans a Join link can join the list', () => {
    render(
      <ShareLinkQrDialog link={link({ level: 'join' })} listName="Our wedding" onClose={vi.fn()} />
    );
    expect(screen.getByRole('dialog', { name: 'QR code' })).toHaveTextContent(QR_WARNINGS.join);
    expect(screen.getByTestId('qr-print-card')).toHaveTextContent(PRINT_CARD_CALLS.join);
  });

  it('downloads the SVG of exactly the link’s code, named after the list', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    URL.createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:qr';
    });
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      expect(this.download).toBe('our-wedding-qr.svg');
      expect(this.href).toBe('blob:qr');
    });
    render(<ShareLinkQrDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Download SVG' }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs[0].type).toBe('image/svg+xml');
    expect(await blobs[0].text()).toBe(qrSvgFile(qrShape(URL_)));
  });

  it('prints a card with the list’s name, its occasion and the code', async () => {
    const user = userEvent.setup();
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(
      <ShareLinkQrDialog
        link={link()}
        listName="Our wedding"
        occasion={{ kind: 'wedding', date: '2026-06-20', recurrence: null }}
        onClose={vi.fn()}
      />
    );
    const card = screen.getByTestId('qr-print-card');
    expect(card).toHaveClass('qr-print-root', 'hidden', 'print:flex');
    expect(card.parentElement).toBe(document.body);
    expect(card).toHaveTextContent('Our wedding');
    expect(card).toHaveTextContent(/^Our weddingWedding · /);
    expect(card.querySelector('path')).toHaveAttribute('d', qrShape(URL_).path);
    await user.click(screen.getByRole('button', { name: 'Print card' }));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('takes the print card away when it closes', () => {
    const { unmount } = render(
      <ShareLinkQrDialog link={link()} listName="Our wedding" onClose={vi.fn()} />
    );
    expect(screen.getByTestId('qr-print-card')).toBeInTheDocument();
    unmount();
    expect(screen.queryByTestId('qr-print-card')).toBeNull();
  });
});
