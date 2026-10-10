// @vitest-environment jsdom
// The top of a list's page: its banner as a short strip (none without one),
// and its description as plain text, clamped (two lines on a phone, three from sm) with Show more.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import WishlistCover, { WISHLIST_COVER_SIZES } from '@/components/WishlistCover';
import WishlistDescription from '@/components/WishlistDescription';
import { coverGradient } from '@/lib/utils/cover';

const BANNER = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/banner.webp';

describe('WishlistCover', () => {
  afterEach(cleanup);

  it.each([null, undefined, ''])('renders no cover at all for a banner of %j', (bannerUrl) => {
    const { container } = render(<WishlistCover bannerUrl={bannerUrl} seed="w1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the banner as a full-width strip, 2.4:1 on a phone and from sm up 3:1 capped at 240px', () => {
    const { container } = render(<WishlistCover bannerUrl={BANNER} seed="w1" />);
    const img = container.querySelector('img')!;
    const strip = img.parentElement!;
    expect(strip).toBe(container.firstChild);
    expect(strip).toHaveClass(
      'relative',
      'w-full',
      'aspect-[4/1]',
      'sm:aspect-[3/1]',
      'sm:max-h-44'
    );
    // Fetched at the strip's width, not the viewport's past the page's max width.
    expect(img).toHaveAttribute('sizes', WISHLIST_COVER_SIZES);
    // It's the page's hero: loaded eagerly, not when scrolled to.
    expect(img).not.toHaveAttribute('loading', 'lazy');
  });

  it('falls back to the list’s gradient when the banner fails to load', () => {
    const { container } = render(<WishlistCover bannerUrl={BANNER} seed="w1" />);
    act(() => {
      container.querySelector('img')!.dispatchEvent(new Event('error'));
    });
    expect(container.querySelector('img')).toBeNull();
    const probe = document.createElement('div');
    probe.style.background = coverGradient('w1');
    expect((container.firstChild as HTMLElement).style.background).toBe(probe.style.background);
  });
});

// jsdom does no layout, so the paragraph's heights are stood in for: a text
// "runs to" one line per 40 characters (every line break starting a new one),
// 22px each, and the clamp shows at most three of them.
const LINE = 22;
function linesOf(text: string) {
  return text.split('\n').reduce((n, part) => n + Math.max(1, Math.ceil(part.length / 40)), 0);
}
function stubLayout() {
  const scroll = vi
    .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return linesOf(this.textContent ?? '') * LINE;
    });
  const client = vi
    .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
    .mockImplementation(function (this: HTMLElement) {
      const full = linesOf(this.textContent ?? '') * LINE;
      return this.classList.contains('sm:line-clamp-3') ? Math.min(full, 3 * LINE) : full;
    });
  return () => {
    scroll.mockRestore();
    client.mockRestore();
  };
}

const SHORT = 'A few things for the new flat.';
const LONG = [
  'We are celebrating Anna turning thirty with a weekend at the lake house.',
  'She loves slow mornings, good coffee and long walks with the dog.',
  'If you would rather chip in on something bigger, talk to Ben.',
].join('\n\n');

/** The clamped box (the toggle's `aria-controls`), which holds the paragraphs. */
const text = () => document.querySelector<HTMLElement>('.text-body')!;
const toggle = (name: string) => screen.getByRole('button', { name });

describe('WishlistDescription', () => {
  beforeEach(() => stubLayout());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a short description as plain text, with no toggle', () => {
    render(<WishlistDescription text={SHORT} />);
    expect(text()).toHaveTextContent(SHORT);
    expect(text()).toHaveClass('line-clamp-2', 'sm:line-clamp-3', 'text-body');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clamps a long description to three lines, and Show more / Show less toggle it', async () => {
    const user = userEvent.setup();
    render(<WishlistDescription text={LONG} />);
    expect(text()).toHaveClass('sm:line-clamp-3');
    const more = toggle('Show more');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', text().id);

    await user.click(more);
    expect(text()).not.toHaveClass('sm:line-clamp-3');
    const less = toggle('Show less');
    expect(less).toHaveAttribute('aria-expanded', 'true');

    await user.click(less);
    expect(text()).toHaveClass('sm:line-clamp-3');
    expect(toggle('Show more')).toHaveAttribute('aria-expanded', 'false');
  });

  // Paragraphs are blocks, not blank lines: a blank line as the clamp's third
  // line would show as a lone "…" under two lines of text.
  it('keeps its paragraphs as blocks, clamped or not, and its line breaks', async () => {
    const user = userEvent.setup();
    render(<WishlistDescription text={'Thanks everyone!\n\n\nSizes:\nM top, 39 shoes'} />);
    const paragraphs = () => Array.from(text().children).map((p) => p.textContent);
    expect(paragraphs()).toEqual(['Thanks everyone!', 'Sizes:\nM top, 39 shoes']);
    expect(text().children[0].tagName).toBe('P');
    cleanup();

    render(<WishlistDescription text={LONG} />);
    await user.click(toggle('Show more'));
    expect(paragraphs()).toEqual(LONG.split('\n\n'));
  });

  // Whether it overflows is only known once it's laid out, so the server
  // render (and the render that hydrates it) has no toggle: one there would
  // mismatch on a client whose width doesn't overflow it.
  it('renders no toggle on the server, where nothing is measured', () => {
    const html = renderToString(<WishlistDescription text={LONG} />);
    expect(html).toContain('sm:line-clamp-3');
    expect(html).not.toContain('Show more');
  });

  it('measures again when the description changes (a co-owner’s edit, read by the poll)', () => {
    const { rerender } = render(<WishlistDescription text={SHORT} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<WishlistDescription text={LONG} />);
    expect(toggle('Show more')).toBeInTheDocument();
    rerender(<WishlistDescription text={SHORT} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('measures again when its width changes', () => {
    let resized: () => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    let wide = true;
    const scroll = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(() => (wide ? 3 * LINE : 5 * LINE));
    render(<WishlistDescription text={LONG} />);
    expect(screen.queryByRole('button')).toBeNull();

    // Narrower, so the same text runs to five lines.
    wide = false;
    act(() => resized());
    expect(toggle('Show more')).toBeInTheDocument();

    wide = true;
    act(() => resized());
    expect(screen.queryByRole('button')).toBeNull();
    scroll.mockRestore();
  });
});
