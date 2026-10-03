// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The real ImageUpload runs here, since the bug lies between it and the form:
// it calls the form's onChange once /api/upload answers, after the crop dialog
// has closed and the form is usable again. Only what jsdom can't do is stood
// in for: react-easy-crop (it needs real image loading and layout; this one
// reports a crop area as soon as it mounts) and the canvas crop.
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
const getCroppedBlob = vi.fn();
vi.mock('@/lib/utils/cropImage', () => ({
  getCroppedBlob: (...args: unknown[]) => getCroppedBlob(...args),
}));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { id: 'u1', defaultCurrency: 'USD' } } }),
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import ItemForm, { type ItemFormData } from '@/components/ItemForm';
import CreateWishlistModal from '@/components/CreateWishlistModal';

const UPLOADED = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/gift.webp';

beforeAll(() => {
  // useBodyScrollLock restores the scroll position on close; jsdom lacks
  // scrollTo, and the object URLs the crop dialog previews the file through.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  getCroppedBlob.mockReset();
  push.mockReset();
  return () => vi.unstubAllGlobals();
});
// Fail on anything logged: a React warning, or an error while submitting.
beforeEach(() => {
  const consoleError = vi.spyOn(console, 'error');
  return () => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  };
});

/**
 * Stubs fetch: an upload stays in flight until the test answers it, and any
 * other request (creating the wishlist) succeeds at once.
 */
function stubFetch() {
  let answerUpload!: () => void;
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<{ json: () => unknown }>>(
    (url) => {
      if (url !== '/api/upload') {
        return Promise.resolve({
          json: async () => ({ success: true, data: { _id: 'w1', slug: 'birthday' } }),
        });
      }
      return new Promise((resolve) => {
        answerUpload = () => resolve({ json: async () => ({ success: true, url: UPLOADED }) });
      });
    }
  );
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, answerUpload: () => act(async () => answerUpload()) };
}

type User = ReturnType<typeof userEvent.setup>;

/**
 * Picks an image in the form under `root` and crops it, then leaves its
 * upload in flight, with the crop dialog closed and the form usable again.
 */
async function startUpload(user: User, root: HTMLElement) {
  let finishCrop!: (blob: Blob) => void;
  getCroppedBlob.mockImplementation(() => new Promise<Blob>((resolve) => (finishCrop = resolve)));

  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, {
    target: { files: [new File(['image'], 'gift.png', { type: 'image/png' })] },
  });
  await user.click(screen.getByRole('button', { name: 'Crop & upload' }));
  await act(async () => finishCrop(new Blob(['cropped'])));

  expect(screen.queryByRole('dialog', { name: 'Crop image' })).toBeNull();
  expect(screen.getByText('Uploading…')).toBeInTheDocument();
}

/** Replaces a field's value by typing, as the user would. */
async function retype(user: User, field: HTMLElement, text: string) {
  await user.clear(field);
  await user.type(field, text);
}

const existing: ItemFormData = {
  name: 'Old name',
  imageUrl: '',
  price: '',
  currency: 'USD',
  link: '',
  notes: '',
  mostWanted: false,
  isDraft: false,
};

describe('ItemForm — editing while its image uploads', () => {
  // regression: ItemForm handed ImageUpload `(url) => setFormData({ ...formData,
  // imageUrl })`, and the call that lands once the upload answers is the one
  // from the render where "Crop & upload" was clicked. It wrote back the form
  // as it was then, so whatever was typed while the image uploaded (the name,
  // the price, the link, the notes) was reverted when it landed.
  it.each(['create', 'propose', 'review', 'edit'] as const)(
    'regression: keeps what was typed while the image uploaded (%s)',
    async (mode) => {
      const { answerUpload } = stubFetch();
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      const { container } = render(
        <ItemForm
          mode={mode}
          onSubmit={onSubmit}
          onCancel={vi.fn()}
          initialData={mode === 'review' || mode === 'edit' ? existing : undefined}
        />
      );
      await startUpload(user, container);

      const name = screen.getByLabelText(/item name/i);
      const price = screen.getByLabelText(/^price$/i);
      const link = screen.getByLabelText(/product link/i);
      const notes = screen.getByLabelText(/^notes$/i);
      await retype(user, name, 'Bike');
      await user.type(price, '120');
      await user.type(link, 'https://example.com/bike');
      await user.type(notes, 'Blue, please');

      await answerUpload();
      expect(screen.getByAltText('Uploaded image').getAttribute('src')).toContain(
        encodeURIComponent(UPLOADED)
      );
      expect(name).toHaveValue('Bike');
      expect(price).toHaveValue('120.00');
      expect(link).toHaveValue('https://example.com/bike');
      expect(notes).toHaveValue('Blue, please');

      await user.click(screen.getByRole('button', { name: /^submit$/i }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toMatchObject({
        name: 'Bike',
        imageUrl: UPLOADED,
        price: { value: 12000, currency: 'usd' },
        link: 'https://example.com/bike',
        notes: 'Blue, please',
      });
    }
  );
});

describe('CreateWishlistModal — editing while its banner uploads', () => {
  // regression: as in ItemForm, the banner's onChange spread the form as it
  // was when "Crop & upload" was clicked (`{ ...formData, bannerUrl }`), so a
  // name, description or visibility set while the banner uploaded was
  // reverted when it landed.
  it('regression: keeps what was typed while the banner uploaded', async () => {
    const { fetchMock, answerUpload } = stubFetch();
    const user = userEvent.setup();
    render(<CreateWishlistModal isOpen onClose={vi.fn()} />);
    await startUpload(user, screen.getByRole('dialog', { name: 'Create new wishlist' }));

    const name = screen.getByLabelText(/wishlist name/i);
    const description = screen.getByLabelText('Description');
    await user.type(name, 'Birthday');
    await user.type(description, 'Turning 30');
    await user.click(screen.getByRole('button', { name: 'Friends' }));
    expect(screen.getByText(/only your friends/i)).toBeInTheDocument();

    await answerUpload();
    expect(screen.getByAltText('Uploaded image').getAttribute('src')).toContain(
      encodeURIComponent(UPLOADED)
    );
    expect(name).toHaveValue('Birthday');
    expect(description).toHaveValue('Turning 30');
    expect(screen.getByText(/only your friends/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create wishlist' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/wishlists/birthday'));
    const create = fetchMock.mock.calls.find(([url]) => url === '/api/wishlists')!;
    expect(JSON.parse(create[1]!.body as string)).toMatchObject({
      name: 'Birthday',
      description: 'Turning 30',
      visibility: 'friends',
      bannerUrl: UPLOADED,
    });
  });
});
