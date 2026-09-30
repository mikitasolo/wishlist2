// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageUpload from '@/components/ImageUpload';

const BROKEN = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/gone.jpg';
const UPLOADED = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/new.jpg';

describe('ImageUpload', () => {
  // regression: BannerImage's failure flag never reset, and the preview keeps
  // the same instance when an upload swaps `value` from the broken URL to the
  // new one, so the working image stayed blank until the modal was reopened.
  it.each([
    { variant: 'item image / banner', circle: false, alt: 'Uploaded image' },
    { variant: 'profile photo', circle: true, alt: 'Profile photo' },
  ])(
    'regression: shows the new $variant after replacing one that failed to load',
    ({ circle, alt }) => {
      const onChange = vi.fn();
      const { rerender } = render(
        <ImageUpload value={BROKEN} onChange={onChange} circle={circle} />
      );

      fireEvent.error(screen.getByAltText(alt));
      // A broken preview is still an empty box that can be replaced.
      expect(screen.queryByAltText(alt)).toBeNull();
      expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();

      // What the parent does with the URL `onChange` hands back after Replace.
      rerender(<ImageUpload value={UPLOADED} onChange={onChange} circle={circle} />);

      expect(screen.getByAltText(alt).getAttribute('src')).toContain(encodeURIComponent(UPLOADED));
    }
  );
});
