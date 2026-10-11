// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import BookmarkletCard from '@/components/BookmarkletCard';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BookmarkletCard', () => {
  it('sets the javascript: href after mount, from the current origin', () => {
    render(<BookmarkletCard />);
    const link = screen.getByRole('link', { name: 'Add to wishlist' });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(href)).toContain(window.location.origin);
  });

  it('is desktop only: hidden below sm in CSS', () => {
    const { container } = render(<BookmarkletCard />);
    const panel = container.firstElementChild as HTMLElement;
    expect(panel.className).toMatch(/\bhidden\b/);
    expect(panel.className).toMatch(/\bsm:block\b/);
  });

  it('is not rendered on a touch-only device', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const { container } = render(<BookmarkletCard />);
    expect(container).toBeEmptyDOMElement();
  });

  it('points to the add-from-link page for stores that block the bookmarklet', () => {
    render(<BookmarkletCard />);
    expect(screen.getByText(/A few stores block bookmarks/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'a new item' })).toHaveAttribute('href', '/items/new');
  });

  it('clicking it here does nothing but hint to drag it', () => {
    render(<BookmarkletCard />);
    expect(screen.getByText(/Ctrl\+Shift\+B/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Add to wishlist' });
    expect(fireEvent.click(link)).toBe(false); // default prevented
    expect(screen.getByRole('status')).toHaveTextContent('Drag me to your bookmarks bar');
  });
});
