// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SnapshotThumb from '@/components/SnapshotThumb';
import { coverGradient } from '@/lib/utils/cover';

const IMAGE = 'https://teststore42.public.blob.vercel-storage.com/snapshots/abc.jpg';

// jsdom normalises the inline style, so compare against what it makes of the
// gradient rather than the raw string.
function placeholderOf(seed: string) {
  const probe = document.createElement('div');
  probe.style.background = coverGradient(seed);
  return probe.style.background;
}

const frame = (img: HTMLElement) => img.parentElement as HTMLElement;

describe('SnapshotThumb', () => {
  it('shows the image, without the placeholder behind it', () => {
    render(<SnapshotThumb src={IMAGE} alt="Blue Mug" seed="r1" />);
    const img = screen.getByAltText('Blue Mug');
    expect(frame(img).style.background).toBe('');
  });

  it('shows the placeholder when there is no image', () => {
    const { container } = render(<SnapshotThumb src={null} alt="Blue Mug" seed="r1" />);
    expect(screen.queryByAltText('Blue Mug')).toBeNull();
    expect((container.firstChild as HTMLElement).style.background).toBe(placeholderOf('r1'));
  });

  // regression: a reservation made before snapshot blobs shares the item's
  // blob, which the owner frees when they delete the item or replace its image.
  // The thumbnail then showed a blank tile instead of the placeholder.
  it('regression: falls back to the placeholder when the image fails to load', () => {
    const { container } = render(<SnapshotThumb src={IMAGE} alt="Blue Mug" seed="r1" />);

    fireEvent.error(screen.getByAltText('Blue Mug'));

    expect(screen.queryByAltText('Blue Mug')).toBeNull();
    expect((container.firstChild as HTMLElement).style.background).toBe(placeholderOf('r1'));
  });

  it('tries again when the row’s image changes', () => {
    const { rerender } = render(<SnapshotThumb src={IMAGE} alt="Blue Mug" seed="r1" />);
    fireEvent.error(screen.getByAltText('Blue Mug'));

    rerender(<SnapshotThumb src={`${IMAGE}?v=2`} alt="Blue Mug" seed="r1" />);
    expect(screen.getByAltText('Blue Mug')).toBeInTheDocument();
  });
});
