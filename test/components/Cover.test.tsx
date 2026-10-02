// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Cover from '@/components/Cover';
import { coverGradient } from '@/lib/utils/cover';

const IMAGE = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/banner.jpg';

// jsdom normalises the inline style, so compare against what it makes of the
// gradient rather than the raw string.
function placeholderOf(seed: string) {
  const probe = document.createElement('div');
  probe.style.background = coverGradient(seed);
  return probe.style.background;
}

const frame = (img: HTMLElement) => img.parentElement as HTMLElement;

describe('Cover', () => {
  it('shows the image, without the placeholder behind it', () => {
    render(
      <Cover
        sizes="100vw"
        src={IMAGE}
        seed="w1"
        alt="Birthday"
        className="relative aspect-square"
      />
    );
    const img = screen.getByAltText('Birthday');
    expect(frame(img).style.background).toBe('');
    expect(frame(img)).toHaveClass('relative', 'aspect-square');
  });

  it.each([null, undefined, ''])('shows the placeholder when the image is %j', (src) => {
    const { container } = render(<Cover sizes="100vw" src={src} seed="w1" alt="Birthday" />);
    expect(screen.queryByAltText('Birthday')).toBeNull();
    expect((container.firstChild as HTMLElement).style.background).toBe(placeholderOf('w1'));
  });

  // regression: every cover set the gradient only when there was no URL, and
  // BannerImage renders nothing on error, so a deleted blob or a dead external
  // URL left a blank tile instead of the placeholder.
  it('regression: falls back to the placeholder when the image fails to load', () => {
    const { container } = render(<Cover sizes="100vw" src={IMAGE} seed="w1" alt="Birthday" />);

    fireEvent.error(screen.getByAltText('Birthday'));

    expect(screen.queryByAltText('Birthday')).toBeNull();
    expect((container.firstChild as HTMLElement).style.background).toBe(placeholderOf('w1'));
  });

  // regression: Cover hands BannerImage a fresh onError arrow on every render,
  // which reached next/image and made it run `img.src = img.src` each time. In
  // Chromium that restarts an animated cover, so the wishlist page's 5 s poll
  // sent every animated list and item image back to its first frame.
  it('regression: re-renders without re-assigning the image src', () => {
    const { rerender } = render(<Cover sizes="100vw" src={IMAGE} seed="w1" alt="Birthday" />);
    const assignSrc = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');
    try {
      rerender(<Cover sizes="100vw" src={IMAGE} seed="w1" alt="Birthday" />);
      rerender(<Cover sizes="100vw" src={IMAGE} seed="w1" alt="Birthday" />);

      expect(assignSrc).not.toHaveBeenCalled();
    } finally {
      assignSrc.mockRestore();
    }
  });

  it('shows the new image when a broken one is replaced', () => {
    const { rerender, container } = render(
      <Cover sizes="100vw" src={IMAGE} seed="w1" alt="Birthday" />
    );
    fireEvent.error(screen.getByAltText('Birthday'));

    rerender(<Cover sizes="100vw" src={`${IMAGE}?v=2`} seed="w1" alt="Birthday" />);

    expect(screen.getByAltText('Birthday')).toBeInTheDocument();
    expect((container.firstChild as HTMLElement).style.background).toBe('');
  });

  it('keeps its overlays over the image and over the placeholder', () => {
    render(
      <Cover sizes="100vw" src={IMAGE} seed="w1" alt="Birthday">
        <span>Public</span>
      </Cover>
    );
    expect(screen.getByText('Public')).toBeInTheDocument();

    fireEvent.error(screen.getByAltText('Birthday'));

    expect(screen.getByText('Public')).toBeInTheDocument();
  });

  it('renders as an external link when given one', () => {
    render(
      <Cover
        sizes="100vw"
        src={IMAGE}
        seed="i1"
        alt="Blue Mug"
        link={{ href: 'https://shop.example/mug', label: 'View Blue Mug product page' }}
      />
    );
    const link = screen.getByRole('link', { name: 'View Blue Mug product page' });
    expect(link).toHaveAttribute('href', 'https://shop.example/mug');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(frame(screen.getByAltText('Blue Mug'))).toBe(link);
  });

  it('remembers a broken image when the link comes and goes', () => {
    const link = { href: 'https://shop.example/mug', label: 'View Blue Mug product page' };
    const { rerender, container } = render(
      <Cover sizes="100vw" src={IMAGE} seed="i1" alt="Blue Mug" link={link} />
    );
    fireEvent.error(screen.getByAltText('Blue Mug'));

    rerender(<Cover sizes="100vw" src={IMAGE} seed="i1" alt="Blue Mug" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByAltText('Blue Mug')).toBeNull();
    expect((container.firstChild as HTMLElement).style.background).toBe(placeholderOf('i1'));

    rerender(<Cover sizes="100vw" src={IMAGE} seed="i1" alt="Blue Mug" link={link} />);
    expect(screen.getByRole('link').style.background).toBe(placeholderOf('i1'));
  });
});
