// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BannerImage from '@/components/BannerImage';

const BROKEN = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/gone.jpg';
const WORKING = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/new.jpg';

// next/image routes the URL through the optimizer, so match it encoded.
const shows = (url: string) =>
  expect(screen.getByAltText('Cover').getAttribute('src')).toContain(encodeURIComponent(url));

describe('BannerImage', () => {
  it('renders nothing once its image fails to load, and says so', () => {
    const onError = vi.fn();
    render(<BannerImage src={BROKEN} alt="Cover" onError={onError} />);

    fireEvent.error(screen.getByAltText('Cover'));

    expect(screen.queryByAltText('Cover')).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('stays hidden when it rerenders with the same broken URL', () => {
    const { rerender } = render(<BannerImage src={BROKEN} alt="Cover" />);
    fireEvent.error(screen.getByAltText('Cover'));

    rerender(<BannerImage src={BROKEN} alt="Cover" sizes="96px" />);

    expect(screen.queryByAltText('Cover')).toBeNull();
  });

  // regression: the failure was a plain boolean that never reset, so a parent
  // that kept this instance mounted and swapped in a new URL (the upload
  // preview, after Replace) went on rendering nothing for the working image.
  it('regression: tries a new URL after the previous one failed', () => {
    const { rerender } = render(<BannerImage src={BROKEN} alt="Cover" />);
    fireEvent.error(screen.getByAltText('Cover'));

    rerender(<BannerImage src={WORKING} alt="Cover" />);

    shows(WORKING);
  });
});
