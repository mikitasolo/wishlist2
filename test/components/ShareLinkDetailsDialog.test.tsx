// @vitest-environment jsdom
// A share link's dialog (WIS-328, WIS-341, WIS-346): its URL with Copy link
// and the share sheet, the warning for its level, then how its code looks (a
// card in a design, size and copies per sheet, or the bare code) and what to do
// with it (print the card; download or print the code).
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

async function pick(user: ReturnType<typeof userEvent.setup>, select: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: select }));
  await user.click(screen.getByRole('option', { name: option }));
}

const printedCards = () => screen.getByTestId('qr-print-card').querySelectorAll('svg[data-design]');

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
  vi.unstubAllGlobals();
});

describe('ShareLinkDetailsDialog', () => {
  it('warns that anyone who scans a View link can see the list', () => {
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Wedding QR' })).toHaveTextContent(
      LINK_WARNINGS.view
    );
    expect(printedCards()[0]).toHaveTextContent(PRINT_CARD_CALLS.view);
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
    expect(printedCards()[0]).toHaveTextContent(PRINT_CARD_CALLS.join);
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
    await user.click(screen.getByRole('radio', { name: 'QR code only' }));
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
    const root = screen.getByTestId('qr-print-card');
    expect(root).toHaveClass('qr-print-root', 'hidden', 'print:grid');
    expect(root.parentElement).toBe(document.body);
    // A postcard by default, a full sheet of two, in the occasion's design.
    const cards = printedCards();
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-design', 'wedding');
    expect(cards[0]).toHaveAttribute('width', '148mm');
    expect(cards[0]).toHaveTextContent(/^Wishlist\.Our ?weddingWedding · /);
    expect(cards[0]).toHaveTextContent(PRINT_CARD_CALLS.view);
    expect(cards[0]).toHaveTextContent(URL_);
    expect(cards[0].querySelector('[data-qr] path')).toHaveAttribute('d', qrShape(URL_).path);
    // Nothing on the card but what the link's visitors can see.
    expect(screen.queryByRole('button', { name: 'Download SVG' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Print card' }));
    expect(print).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('previews and prints the design, size and copies picked', async () => {
    const user = userEvent.setup();
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    const preview = screen.getByRole('img', { name: 'Card preview for Wedding QR' });
    // No occasion: Classic.
    expect(preview).toHaveAttribute('data-design', 'classic');

    await pick(user, 'Design', 'Confetti');
    expect(screen.getByRole('img', { name: 'Card preview for Wedding QR' })).toHaveAttribute(
      'data-design',
      'confetti'
    );

    // A new size starts on a full sheet of it.
    await pick(user, 'Size', 'Credit card · 85 × 54 mm');
    expect(printedCards()).toHaveLength(8);
    expect(printedCards()[0]).toHaveAttribute('data-design', 'confetti');
    expect(printedCards()[0]).toHaveAttribute('width', '85mm');
    expect(screen.getByTestId('qr-print-card').style.gridTemplateColumns).toBe('repeat(2, 85mm)');

    await pick(user, 'Copies per sheet', '3');
    expect(printedCards()).toHaveLength(3);

    // One to a sheet: nothing to pick.
    await pick(user, 'Size', 'A5 · 148 × 210 mm');
    expect(printedCards()).toHaveLength(1);
    expect(screen.queryByRole('combobox', { name: 'Copies per sheet' })).toBeNull();
  });

  it('follows the list’s occasion until a design is picked', async () => {
    const user = userEvent.setup();
    const props = { link: link(), listName: 'Our wedding', onClose: vi.fn() };
    const { rerender } = render(<ShareLinkDetailsDialog {...props} />);
    const preview = () => screen.getByRole('img', { name: 'Card preview for Wedding QR' });
    expect(preview()).toHaveAttribute('data-design', 'classic');
    // The occasion is set while the dialog is open (a co-owner, on the poll).
    rerender(
      <ShareLinkDetailsDialog
        {...props}
        occasion={{ kind: 'birthday', date: '2026-06-20', recurrence: null }}
      />
    );
    expect(preview()).toHaveAttribute('data-design', 'birthday');
    await pick(user, 'Design', 'Ribbon');
    rerender(
      <ShareLinkDetailsDialog
        {...props}
        occasion={{ kind: 'wedding', date: '2026-06-20', recurrence: null }}
      />
    );
    expect(preview()).toHaveAttribute('data-design', 'ribbon');
  });

  it('downloads the card as a PNG of the design and size picked, at 300 dpi', async () => {
    const user = userEvent.setup();
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blobs.push(b as Blob);
      return `blob:${blobs.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    // jsdom draws nothing: an image that loads, and a canvas that hands back a PNG.
    const drawn: { src?: string; w?: number; h?: number } = {};
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(v: string) {
          drawn.src = v;
          queueMicrotask(() => this.onload?.());
        }
      }
    );
    const png = new Blob(['png'], { type: 'image/png' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement
    ) {
      drawn.w = this.width;
      drawn.h = this.height;
      return { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: '' } as never;
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(png));
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      saved.push(`${this.download} ${this.href}`);
    });

    render(
      <ShareLinkDetailsDialog
        link={link()}
        listName="Our wedding"
        occasion={{ kind: 'wedding', date: '2026-06-20', recurrence: null }}
        onClose={vi.fn()}
      />
    );
    await pick(user, 'Size', 'Credit card · 85 × 54 mm');
    await user.click(screen.getByRole('button', { name: 'Download PNG' }));

    await vi.waitFor(() => expect(saved).toHaveLength(1));
    // The card's own SVG, at the image's pixels, drawn into a canvas of them.
    const svg = await blobs[0].text();
    expect(blobs[0].type).toBe('image/svg+xml');
    expect(drawn.src).toBe('blob:1');
    expect(svg).toContain('width="1004" height="638"');
    expect(svg).toContain('data-design="wedding"');
    expect(svg).toContain(qrShape(URL_).path);
    expect(svg).not.toContain('class=');
    expect([drawn.w, drawn.h]).toEqual([1004, 638]);
    expect(blobs[1]).toBe(png);
    expect(saved[0]).toBe('our-wedding-qr-card.png blob:2');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('says so when the browser can’t draw the card', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_: string) {
          queueMicrotask(() => this.onerror?.());
        }
      }
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Download PNG' }));
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Couldn’t make the PNG. Try Print card.', 'error')
    );
    expect(click).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:x');
  });

  it('says so, rather than hang, when the canvas can’t be read back', async () => {
    const user = userEvent.setup();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        set src(_: string) {
          queueMicrotask(() => this.onload?.());
        }
      }
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    // A tainted canvas (older WebKit) throws instead of handing back a blob.
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(() => {
      throw new DOMException('Tainted canvas', 'SecurityError');
    });
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Download PNG' });
    await user.click(button);
    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Couldn’t make the PNG. Try Print card.', 'error')
    );
    expect(revoke).toHaveBeenCalledWith('blob:x');
    // Free to try again.
    expect(button).toBeEnabled();
  });

  it('downloads or prints the bare code once QR code only is picked', async () => {
    const user = userEvent.setup();
    render(<ShareLinkDetailsDialog link={link()} listName="Our wedding" onClose={vi.fn()} />);
    await user.click(screen.getByRole('radio', { name: 'QR code only' }));
    expect(screen.getByRole('img', { name: 'QR code for Wedding QR' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Design' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Download PNG' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Print$/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Print card' })).toBeNull();
    const root = screen.getByTestId('qr-print-card');
    expect(printedCards()).toHaveLength(0);
    expect(root.querySelectorAll('path')).toHaveLength(1);
    // With its URL under it, to type when a scan fails.
    expect(root).toHaveTextContent(URL_);
    expect(root.querySelector('path')).toHaveAttribute('d', qrShape(URL_).path);
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
