// @vitest-environment jsdom
// A share link's dialog (WIS-328, WIS-341): its URL with Copy link and the
// share sheet, the warning for its level, the SVG download, and the print card
// with the list's name and occasion.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/hooks/useLocalToday', () => ({ useLocalToday: () => '2026-06-01' }));
const { sheet } = vi.hoisted(() => ({ sheet: { available: false } }));
vi.mock('@/lib/hooks/useShareSheetAvailable', () => ({
  useShareSheetAvailable: () => sheet.available,
}));

import ShareLinkDetailsDialog, {
  LINK_WARNINGS,
  PRINT_CARD_CALLS,
} from '@/components/ShareLinkDetailsDialog';
import type { ShareLinkRow } from '@/lib/hooks/useShareLinks';
import { qrShape, qrSvgFile } from '@/lib/utils/qrCode';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const URL_ = `${window.location.origin}/l/${TOKEN}`;

const link = (over: Partial<ShareLinkRow> = {}): ShareLinkRow & { token: string } => ({
  _id: 'l1',
  level: 'view',
  label: 'Wedding QR',
  expiresAt: null,
  untilOccasion: false,
  createdAt: new Date(2026, 5, 1).toISOString(),
  state: 'live',
  joinedCount: 0,
  token: TOKEN,
  ...over,
});

beforeEach(() => {
  showToast.mockReset();
  sheet.available = false;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ShareLinkDetailsDialog', () => {
  it('warns that anyone who scans a View link can see the list', () => {
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Wedding QR' })).toHaveTextContent(
      LINK_WARNINGS.view
    );
    expect(screen.getByTestId('qr-print-card')).toHaveTextContent(PRINT_CARD_CALLS.view);
  });

  it('warns that anyone who scans a Join link can join the list', () => {
    render(
      <ShareLinkDetailsDialog
        link={link({ level: 'join' })}
        listName="Our wedding"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Wedding QR' })).toHaveTextContent(
      LINK_WARNINGS.join
    );
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
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
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
      <ShareLinkDetailsDialog
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

  it('shows the link’s full URL and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    expect(screen.getByLabelText('Link')).toHaveValue(URL_);
    expect(screen.getByLabelText('Link')).toHaveAttribute('readonly');
    // No share sheet off a phone.
    expect(screen.queryByRole('button', { name: /^Share$/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(URL_);
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');
  });

  it('hands the link to the phone’s share sheet', async () => {
    const user = userEvent.setup();
    sheet.available = true;
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: /^Share$/ }));
    expect(share).toHaveBeenCalledWith({ url: URL_, title: 'Our wedding' });
    Reflect.deleteProperty(navigator, 'share');
  });

  it('is titled “Share link” for a link without a label, and says when it never expires', () => {
    render(
      <ShareLinkDetailsDialog
        link={link({ label: null })}
        listName="Our wedding"
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Share link' })).toHaveTextContent('Never expires');
  });

  it('takes the print card away when it closes', () => {
    const { unmount } = render(
      <ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />
    );
    expect(screen.getByTestId('qr-print-card')).toBeInTheDocument();
    unmount();
    expect(screen.queryByTestId('qr-print-card')).toBeNull();
  });
});
