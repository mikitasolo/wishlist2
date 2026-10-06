// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// The crop step is its own dialog; stub it so a chosen file shows up as a prop.
vi.mock('@/components/ImageCropModal', () => ({
  default: ({ file }: { file: File }) => <div data-testid="crop">{file.name}</div>,
}));

import ImageUpload from '@/components/ImageUpload';

const PHOTO = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/new.jpg';

describe('ImageUpload — compact photo row (the item form)', () => {
  it('offers Add photo when empty, with no big drop zone', () => {
    render(<ImageUpload compact value={null} onChange={vi.fn()} />);
    // One control: the dashed tile is the button, not an empty box beside it.
    expect(screen.getAllByRole('button')).toEqual([
      screen.getByRole('button', { name: 'Add photo' }),
    ]);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.queryByText(/drag & drop/i)).toBeNull();
  });

  it('shows the thumbnail with Replace and Remove once there is a photo', () => {
    const onChange = vi.fn();
    render(<ImageUpload compact value={PHOTO} onChange={onChange} />);
    expect(screen.getByAltText('Item photo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('opens the crop step for a chosen file', () => {
    const { container } = render(<ImageUpload compact value={null} onChange={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'gift.png', { type: 'image/png' })] },
    });
    expect(screen.getByTestId('crop')).toHaveTextContent('gift.png');
  });

  it('takes an image dropped anywhere on the page, and ignores a drop that is not a file', () => {
    render(<ImageUpload compact value={null} onChange={vi.fn()} />);
    const text = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer?: unknown;
    };
    text.dataTransfer = { types: ['text/plain'], files: [] };
    document.body.dispatchEvent(text);
    expect(screen.queryByTestId('crop')).toBeNull();

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as Event & {
      dataTransfer?: unknown;
    };
    drop.dataTransfer = {
      types: ['Files'],
      files: [new File(['x'], 'dropped.png', { type: 'image/png' })],
    };
    act(() => {
      document.body.dispatchEvent(drop);
    });
    expect(screen.getByTestId('crop')).toHaveTextContent('dropped.png');
  });
});
