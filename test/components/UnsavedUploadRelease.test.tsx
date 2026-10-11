// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// WIS-181: an upload a form lets go of before any save took it (replaced,
// removed, the form cancelled or closed, a photo landing for an item already
// saved) is handed back to DELETE /api/upload. One a save took, or may have,
// and an image the form opened with, never are. The real ImageUpload runs; only
// the cropper and the canvas crop are stood in for, as in ImageUploadFormEdits.
vi.mock('react-easy-crop', async () => {
  const { useEffect } = await import('react');
  return {
    default: function Cropper({
      onCropComplete,
    }: {
      onCropComplete: (area: unknown, pixels: unknown) => void;
    }) {
      useEffect(() => {
        onCropComplete({}, { x: 0, y: 0, width: 10, height: 10 });
      }, [onCropComplete]);
      return <div data-testid="cropper" />;
    },
  };
});
vi.mock('@/lib/utils/cropImage', () => ({
  getCroppedBlob: async () => new Blob(['cropped']),
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1', defaultCurrency: 'USD' } } }),
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import ItemForm from './ItemFormWithFooter';
import type { ItemFormData } from '@/components/ItemForm';
import CreateWishlistModal from '@/components/CreateWishlistModal';

const STORE = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1';
const RECORD_IMAGE = `${STORE}/on-the-item.webp`;

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  push.mockReset();
  return () => vi.unstubAllGlobals();
});

/**
 * Stubs fetch. Each upload answers with the next URL (`upload-1.webp`, …), at
 * once or, with `hold`, when the test lets it go; creating a list answers with
 * `createAnswer`; a DELETE /api/upload is recorded in `released`.
 */
function stubFetch() {
  const state = {
    uploads: 0,
    hold: false,
    pending: null as null | (() => void),
    createAnswer: { success: true, data: { _id: 'w1', slug: 'birthday' } } as unknown,
    released: [] as string[],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/upload' && init?.method === 'DELETE') {
        state.released.push(JSON.parse(String(init.body)).url);
        return { json: async () => ({ success: true }) };
      }
      if (url === '/api/upload') {
        const answer = { success: true, url: `${STORE}/upload-${++state.uploads}.webp` };
        if (state.hold) await new Promise<void>((resolve) => (state.pending = resolve));
        return { json: async () => answer };
      }
      return { json: async () => state.createAnswer };
    })
  );
  return state;
}

type User = ReturnType<typeof userEvent.setup>;

/** Picks and crops an image, and waits for its upload to land (unless it's held). */
async function upload(user: User, root: HTMLElement = document.body) {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, {
    target: { files: [new File(['image'], 'gift.png', { type: 'image/png' })] },
  });
  await user.click(await screen.findByRole('button', { name: 'Crop & upload' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Crop image' })).toBeNull());
}

const shownPhoto = () =>
  decodeURIComponent(screen.queryByAltText('Item photo')?.getAttribute('src') ?? '');

const existing: ItemFormData = {
  name: 'Old name',
  imageUrl: RECORD_IMAGE,
  price: '',
  currency: 'USD',
  link: '',
  notes: '',
  mostWanted: false,
  tags: [],
  isDraft: false,
  relatedItems: [],
};

function renderForm(props: Partial<Parameters<typeof ItemForm>[0]> = {}) {
  return render(
    <ItemForm
      mode="create"
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
      {...props}
    />
  );
}

describe('ItemForm — handing back photos no save took', () => {
  it('hands back a photo when the dialog closes without saving it', async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const { unmount } = renderForm();
    await upload(user);
    await waitFor(() => expect(shownPhoto()).toContain('upload-1.webp'));
    expect(state.released).toEqual([]);
    unmount();
    expect(state.released).toEqual([`${STORE}/upload-1.webp`]);
  });

  it('hands back a photo replaced or removed before a save, at once', async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const { unmount } = renderForm();
    await upload(user);
    await waitFor(() => expect(shownPhoto()).toContain('upload-1.webp'));
    await upload(user);
    await waitFor(() => expect(shownPhoto()).toContain('upload-2.webp'));
    expect(state.released).toEqual([`${STORE}/upload-1.webp`]);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(state.released).toEqual([`${STORE}/upload-1.webp`, `${STORE}/upload-2.webp`]);
    unmount();
    expect(state.released).toHaveLength(2);
  });

  it("never hands back the image the item opened with, the edit's or a review's", async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const { unmount } = renderForm({ mode: 'edit', initialData: existing });
    // Replaced by an upload, then that removed: only the upload goes back.
    await upload(user);
    await waitFor(() => expect(shownPhoto()).toContain('upload-1.webp'));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    unmount();
    expect(state.released).toEqual([`${STORE}/upload-1.webp`]);

    renderForm({ mode: 'review', initialData: existing });
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    cleanup();
    expect(state.released).toEqual([`${STORE}/upload-1.webp`]);
  });

  it('keeps a photo a save took when the dialog then closes', async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderForm({ mode: 'edit', initialData: existing, onSubmit });
    await upload(user);
    await waitFor(() => expect(shownPhoto()).toContain('upload-1.webp'));
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    unmount();
    expect(state.released).toEqual([]);
  });

  it("keeps a photo whose save failed, since a failure can't say it didn't land", async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onSubmit = vi.fn().mockRejectedValue(new Error('The request took too long.'));
    const { unmount } = renderForm({ onSubmit });
    await upload(user);
    await waitFor(() => expect(shownPhoto()).toContain('upload-1.webp'));
    await user.type(screen.getByLabelText(/item name/i), 'Bike');
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Still shown, and kept even once the dialog closes.
    expect(shownPhoto()).toContain('upload-1.webp');
    unmount();
    expect(state.released).toEqual([]);
    consoleError.mockRestore();
  });

  it('hands back a photo that lands after its item was saved (Keep adding)', async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm({ onSubmit });
    state.hold = true;
    await upload(user);
    await waitFor(() => expect(state.pending).not.toBeNull());
    await user.type(screen.getByLabelText(/item name/i), 'Bike');
    await user.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText(/item name/i)).toHaveValue(''));

    await act(async () => state.pending!());
    await waitFor(() => expect(state.released).toEqual([`${STORE}/upload-1.webp`]));
    expect(shownPhoto()).toBe('');
  });

  it('hands back a photo that lands once the dialog has closed', async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const { unmount } = renderForm();
    state.hold = true;
    await upload(user);
    await waitFor(() => expect(state.pending).not.toBeNull());
    unmount();
    expect(state.released).toEqual([]);
    await act(async () => state.pending!());
    await waitFor(() => expect(state.released).toEqual([`${STORE}/upload-1.webp`]));
  });
});

describe('CreateWishlistModal — handing back a banner no create took', () => {
  const dialog = () => screen.getByRole('dialog', { name: 'Create new wishlist' });

  it('hands back the banner when the modal closes without creating the list', async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const { rerender } = render(<CreateWishlistModal isOpen onClose={vi.fn()} />);
    await upload(user, dialog());
    await waitFor(() => expect(screen.getByAltText('Uploaded image')).toBeInTheDocument());
    rerender(<CreateWishlistModal isOpen={false} onClose={vi.fn()} />);
    await waitFor(() => expect(state.released).toEqual([`${STORE}/upload-1.webp`]));
  });

  it('keeps a refused create’s banner in the form, and hands it back on close', async () => {
    const state = stubFetch();
    state.createAnswer = { success: false, error: 'Something is wrong' };
    const user = userEvent.setup();
    const { rerender } = render(<CreateWishlistModal isOpen onClose={vi.fn()} />);
    await upload(user, dialog());
    await waitFor(() => expect(screen.getByAltText('Uploaded image')).toBeInTheDocument());
    await user.type(screen.getByLabelText(/wishlist name/i), 'Birthday');
    await user.click(screen.getByRole('button', { name: 'Create wishlist' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Create wishlist' })).toBeEnabled()
    );
    expect(screen.getByAltText('Uploaded image')).toBeInTheDocument();
    expect(state.released).toEqual([]);
    rerender(<CreateWishlistModal isOpen={false} onClose={vi.fn()} />);
    await waitFor(() => expect(state.released).toEqual([`${STORE}/upload-1.webp`]));
  });

  it('keeps the banner of a list it created', async () => {
    const state = stubFetch();
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<CreateWishlistModal isOpen onClose={onClose} />);
    await upload(user, dialog());
    await waitFor(() => expect(screen.getByAltText('Uploaded image')).toBeInTheDocument());
    await user.type(screen.getByLabelText(/wishlist name/i), 'Birthday');
    await user.click(screen.getByRole('button', { name: 'Create wishlist' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    rerender(<CreateWishlistModal isOpen={false} onClose={onClose} />);
    cleanup();
    expect(state.released).toEqual([]);
  });
});
