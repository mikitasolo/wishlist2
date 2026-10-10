// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emulateFocusFixup } from '../focusFixup';

// react-easy-crop needs real image loading and layout; a stand-in reports a
// crop area as soon as it mounts, as the real one does once the image loads,
// and is a Tab stop, as the real crop area is (it moves with the arrow keys).
// A test sets `value` to keep the stand-in from reporting an area, as the real
// one doesn't until its image has loaded.
const cropperHeld = vi.hoisted(() => ({ value: false }));
vi.mock('react-easy-crop', async () => {
  const { useEffect } = await import('react');
  return {
    default: function Cropper({
      image,
      onCropComplete,
    }: {
      image: string;
      onCropComplete: (area: unknown, pixels: unknown) => void;
    }) {
      useEffect(() => {
        if (cropperHeld.value) return;
        onCropComplete({}, { x: 0, y: 0, width: 10, height: 10 });
      }, [image, onCropComplete]);
      return <div tabIndex={0} aria-label="Crop area" data-testid="cropper" />;
    },
  };
});
// Cropping draws on a canvas, which jsdom doesn't have.
const getCroppedBlob = vi.fn();
vi.mock('@/lib/utils/cropImage', () => ({
  getCroppedBlob: (...args: unknown[]) => getCroppedBlob(...args),
}));

import AddItemModal from '@/components/AddItemModal';
import ImageCropModal from '@/components/ImageCropModal';
import ImageUpload from '@/components/ImageUpload';

beforeAll(() => {
  // useBodyScrollLock restores the scroll position on close; jsdom lacks
  // scrollTo, and the object URLs the crop dialog previews the file through.
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  let previews = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++previews}`);
  URL.revokeObjectURL = vi.fn();
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  getCroppedBlob.mockReset();
  cropperHeld.value = false;
  return () => vi.unstubAllGlobals();
});
// Fail on anything logged: a React warning, or an error while moving focus.
beforeEach(() => {
  const consoleError = vi.spyOn(console, 'error');
  return () => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  };
});

const itemModal = () => screen.getByRole('dialog', { name: 'Add new item' });
const cropDialog = () => screen.getByRole('dialog', { name: 'Crop image' });
const inCrop = () => within(cropDialog());
const dropZone = () => screen.getByRole('button', { name: 'Add photo' });

/** Picks an image in the file input under `root`, as the file picker would. */
function pickImage(root: HTMLElement, name = 'gift.png') {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]')!;
  fireEvent.change(input, {
    target: { files: [new File(['image'], name, { type: 'image/png' })] },
  });
}

/**
 * Opens the Add item modal and picks an image in its form, as a click on the
 * drop zone and a choice in the file picker would.
 */
async function openCropOverItemModal({
  onAdd = vi.fn(),
  onClose = vi.fn(),
}: { onAdd?: () => Promise<void>; onClose?: () => void } = {}) {
  const user = userEvent.setup();
  render(
    <AddItemModal
      isOpen
      onClose={onClose}
      onAdd={onAdd}
      wishlistCurrency="USD"
      userCurrency="USD"
    />
  );
  // Named, so the form would submit. Filled without typing: user-event fires
  // `change` (in an act) when a field it saw edited loses focus, which here is
  // inside React's commit.
  fireEvent.change(screen.getByLabelText(/item name/i), { target: { value: 'Bike' } });
  await user.click(dropZone());
  expect(dropZone()).toHaveFocus();

  pickImage(itemModal());
  expect(await screen.findByRole('dialog', { name: 'Crop image' })).toBeInTheDocument();
  // The stand-in cropper has reported its area, so Crop & upload is enabled.
  await waitFor(() =>
    expect(inCrop().getByRole('button', { name: 'Crop & upload' })).toBeEnabled()
  );
  return user;
}

/**
 * Crops that stay in flight until the test settles them: by default the one
 * started last, else the `n`th (from 0) since this was called.
 */
function pendingCrop() {
  const crops: { resolve: (blob: Blob) => void; reject: (error: Error) => void }[] = [];
  getCroppedBlob.mockImplementation(
    () =>
      new Promise<Blob>((resolve, reject) => {
        crops.push({ resolve, reject });
      })
  );
  const nth = (n?: number) => crops[n ?? crops.length - 1];
  return {
    succeed: (blob = new Blob(['cropped']), n?: number) => act(async () => nth(n).resolve(blob)),
    fail: (n?: number) => act(async () => nth(n).reject(new Error('Could not crop'))),
  };
}

describe('ImageCropModal — keyboard focus over an item modal', () => {
  // regression: the crop dialog had no focus management, so focus stayed on
  // the drop zone in the form behind its backdrop.
  it('regression: moves focus into the crop dialog when it opens', async () => {
    await openCropOverItemModal();

    // Its close button (named Cancel, like the Cancel button at the bottom).
    expect(inCrop().getAllByRole('button', { name: 'Cancel' })[0]).toHaveFocus();
  });

  // regression: the crop dialog is rendered inside the item modal's form, so
  // the item modal's trap cycled Tab through both: Tab from Crop & upload
  // reached the item form's fields behind the crop dialog's backdrop.
  it('regression: keeps Tab and Shift+Tab in the crop dialog, never reaching the item form', async () => {
    const user = await openCropOverItemModal();
    const [close, cancel] = inCrop().getAllByRole('button', { name: 'Cancel' });

    expect(close).toHaveFocus();
    await user.tab();
    expect(inCrop().getByLabelText('Crop area')).toHaveFocus();
    await user.tab();
    expect(inCrop().getByLabelText('Zoom')).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(inCrop().getByRole('button', { name: 'Crop & upload' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(inCrop().getByRole('button', { name: 'Crop & upload' })).toHaveFocus();
  });

  // regression: closing the crop dialog left focus where it had been, and the
  // item modal's trap had been cycling through the crop dialog's controls.
  it('regression: hands focus back to the drop zone on cancel, and the item modal traps Tab again', async () => {
    const user = await openCropOverItemModal();

    await user.click(inCrop().getAllByRole('button', { name: 'Cancel' })[1]);
    expect(screen.queryByText('Crop image')).toBeNull();
    expect(dropZone()).toHaveFocus();

    const closeItemModal = screen.getByRole('button', { name: 'Close modal' });
    const addItem = screen.getByRole('button', { name: 'Add to list' });
    act(() => addItem.focus());
    await user.tab();
    expect(closeItemModal).toHaveFocus();
    await user.tab({ shift: true });
    expect(addItem).toHaveFocus();
  });

  // regression: the crop dialog's own Escape listener and the item modal's
  // both handled the key, so Escape closed the item modal too (or, with
  // unsaved changes, asked to discard them).
  it('regression: cancels only the crop on Escape, then the item modal traps Tab again', async () => {
    const onClose = vi.fn();
    const user = await openCropOverItemModal({ onClose });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Crop image' })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(itemModal()).toBeInTheDocument();
    expect(dropZone()).toHaveFocus();
    await user.tab();
    expect(itemModal()).toContainElement(document.activeElement as HTMLElement);

    // The next Escape is the item modal's again.
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
  });

  // regression: the crop dialog's close button had no type, so inside the
  // item form it was a submit button, and it's what has focus when the dialog
  // opens: Enter on it submitted the item.
  it("regression: Enter on the crop dialog's close button cancels the crop without submitting the item", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = await openCropOverItemModal({ onAdd });

    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Crop image' })).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
    expect(itemModal()).toBeInTheDocument();
    expect(dropZone()).toHaveFocus();
  });
});

describe('ImageCropModal — keyboard focus while it crops', () => {
  // A disabled control drops focus to <body>, as in a browser.
  beforeEach(() => emulateFocusFixup());

  // regression: cropping disabled the focused Crop & upload button, which
  // dropped focus to <body> behind both backdrops; if the crop failed, it
  // stayed there.
  it('regression: holds focus on the crop dialog while it crops, then hands it back to Crop & upload if that fails', async () => {
    const crop = pendingCrop();
    const user = await openCropOverItemModal();
    const confirm = inCrop().getByRole('button', { name: 'Crop & upload' });

    await user.click(confirm);
    expect(inCrop().getByRole('button', { name: 'Uploading…' })).toBeDisabled();
    expect(cropDialog()).toHaveFocus();

    await crop.fail();
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveFocus();
  });

  it('hands focus back to the drop zone once the upload that follows the crop fails', async () => {
    const crop = pendingCrop();
    let answerUpload!: (body: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            answerUpload = (body) => resolve({ json: async () => body });
          })
      )
    );
    const user = await openCropOverItemModal();
    const opener = dropZone();

    await user.click(inCrop().getByRole('button', { name: 'Crop & upload' }));
    await crop.succeed();
    // The crop dialog has closed; the drop zone is disabled while it uploads.
    expect(screen.queryByText('Crop image')).toBeNull();
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(opener).toBeDisabled();

    await act(async () => answerUpload({ success: false, error: 'Upload failed.' }));
    expect(screen.getByText('Upload failed.')).toBeInTheDocument();
    expect(opener).toBeEnabled();
    expect(opener).toHaveFocus();
  });

  // regression: a successful upload swaps the drop zone the crop dialog had
  // handed focus back to for the preview, and focus dropped to <body> with it.
  it("regression: hands focus to the preview's Replace once the upload replaces the drop zone", async () => {
    const crop = pendingCrop();
    let answerUpload!: (body: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            answerUpload = (body) => resolve({ json: async () => body });
          })
      )
    );
    const user = await openCropOverItemModal();

    await user.click(inCrop().getByRole('button', { name: 'Crop & upload' }));
    await crop.succeed();
    await act(async () =>
      answerUpload({
        success: true,
        url: 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/gift.webp',
      })
    );

    expect(screen.queryByRole('button', { name: /click to upload/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace' })).toHaveFocus();
  });
});

const UPLOADED = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/gift.webp';
const EXISTING = 'https://teststore42.public.blob.vercel-storage.com/uploads/u1/old.webp';

type User = ReturnType<typeof userEvent.setup>;

/** Stubs /api/upload to take whatever it's sent; returns the stub. */
function stubUpload() {
  const upload = vi.fn<(url: string, init?: RequestInit) => Promise<{ json: () => unknown }>>(
    async () => ({ json: async () => ({ success: true, url: UPLOADED }) })
  );
  vi.stubGlobal('fetch', upload);
  return upload;
}

/** The image the upload stub was sent, read back as text. */
const uploadedText = (upload: ReturnType<typeof stubUpload>, call = 0) =>
  ((upload.mock.calls[call][1]!.body as FormData).get('file') as File).text();

const cropButton = () => inCrop().getByRole('button', { name: 'Crop & upload' });

// The crop dialog's three ways out, each taken while a crop runs.
const WAYS_OUT = [
  {
    way: 'its close button',
    leave: (user: User) => user.click(inCrop().getAllByRole('button', { name: 'Cancel' })[0]),
  },
  {
    way: 'its Cancel button',
    leave: (user: User) => user.click(inCrop().getAllByRole('button', { name: 'Cancel' })[1]),
  },
  { way: 'Escape', leave: (user: User) => user.keyboard('{Escape}') },
];

describe('ImageCropModal — cancelling while it crops', () => {
  // A disabled control drops focus to <body>, as in a browser.
  beforeEach(() => emulateFocusFixup());

  // regression: while the crop ran only the bottom Cancel was disabled. The
  // close button and Escape closed the dialog, and when the crop finished its
  // result was handed to ImageUpload all the same, which uploaded the image
  // (against the user's quota) and put it in the item's image field. Now that
  // a cancelled crop is dropped, the bottom Cancel works while it runs too.
  it.each(WAYS_OUT)(
    'regression: uploads nothing, and the new item gets no image, when $way cancels the crop',
    async ({ leave }) => {
      const crop = pendingCrop();
      const upload = stubUpload();
      const onAdd = vi.fn().mockResolvedValue(undefined);
      const user = await openCropOverItemModal({ onAdd });

      await user.click(cropButton());
      expect(inCrop().getByRole('button', { name: 'Uploading…' })).toBeDisabled();
      await leave(user);
      expect(screen.queryByRole('dialog', { name: 'Crop image' })).toBeNull();
      expect(dropZone()).toHaveFocus();

      await crop.succeed();
      expect(upload).not.toHaveBeenCalled();
      expect(dropZone()).toBeEnabled();
      expect(screen.queryByAltText('Item photo')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Add to list' }));
      await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
      expect(onAdd.mock.calls[0][0]).toMatchObject({ name: 'Bike' });
      expect(onAdd.mock.calls[0][0].imageUrl).toBeUndefined();
    }
  );

  // regression: as above, over the image the field already had, which the
  // cancelled one was to replace.
  it.each(WAYS_OUT)(
    'regression: keeps the image the field had when $way cancels the crop of its replacement',
    async ({ leave }) => {
      const crop = pendingCrop();
      const upload = stubUpload();
      const onChange = vi.fn();
      const user = userEvent.setup();
      const { container } = render(<ImageUpload value={EXISTING} onChange={onChange} />);

      await user.click(screen.getByRole('button', { name: 'Replace' }));
      pickImage(container);
      await user.click(cropButton());
      await leave(user);
      await crop.succeed();

      expect(upload).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByAltText('Uploaded image').getAttribute('src')).toContain(
        encodeURIComponent(EXISTING)
      );
      expect(screen.getByRole('button', { name: 'Replace' })).toHaveFocus();
    }
  );

  // regression: a crop's result outlived the dialog, so leaving the page (or
  // the form closing) while it ran still uploaded the image.
  it('regression: uploads nothing when the crop finishes after the form it was for has gone', async () => {
    const crop = pendingCrop();
    const upload = stubUpload();
    const user = await openCropOverItemModal();

    await user.click(cropButton());
    cleanup();
    await crop.succeed();

    expect(upload).not.toHaveBeenCalled();
  });

  // regression: the cancelled crop's result still landed when it finished
  // after the next image's crop had started: it was uploaded too, it closed
  // the new crop dialog, and whichever upload answered last won the field.
  it('regression: uploads only the image picked again after a cancel, when the cancelled crop finishes later', async () => {
    const crop = pendingCrop();
    const upload = stubUpload();
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = await openCropOverItemModal({ onAdd });

    await user.click(cropButton());
    await user.keyboard('{Escape}');
    pickImage(itemModal(), 'other.png');
    await user.click(cropButton());

    await crop.succeed(new Blob(['cancelled']), 0);
    expect(upload).not.toHaveBeenCalled();
    expect(inCrop().getByRole('button', { name: 'Uploading…' })).toBeDisabled();

    await crop.succeed(new Blob(['picked again']), 1);
    expect(await screen.findByAltText('Item photo')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(await uploadedText(upload)).toBe('picked again');

    await user.click(screen.getByRole('button', { name: 'Add to list' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0].imageUrl).toBe(UPLOADED);
  });

  // A parent that keeps the dialog open on cancel: the cancelled crop must
  // neither land nor leave the dialog stuck on "Uploading…".
  it.each(['finishes', 'fails'] as const)(
    'drops a cancelled crop that %s while the next one runs, and hands the next one on',
    async (outcome) => {
      const crop = pendingCrop();
      const onCancel = vi.fn();
      const onCropped = vi.fn();
      const user = userEvent.setup();
      render(
        <ImageCropModal
          file={new File(['image'], 'gift.png', { type: 'image/png' })}
          aspect={1}
          onCancel={onCancel}
          onCropped={onCropped}
        />
      );

      await user.click(cropButton());
      await user.keyboard('{Escape}');
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(cropButton()).toBeEnabled();

      await user.click(cropButton());
      if (outcome === 'finishes') await crop.succeed(new Blob(['cancelled']), 0);
      else await crop.fail(0);
      expect(onCropped).not.toHaveBeenCalled();
      expect(inCrop().getByRole('button', { name: 'Uploading…' })).toBeDisabled();

      const kept = new Blob(['kept']);
      await crop.succeed(kept, 1);
      expect(onCropped).toHaveBeenCalledExactlyOnceWith(kept);
    }
  );

  // A paste while the dialog is open hands it another file to crop.
  it('drops the crop of a file the dialog is handed another one in place of', async () => {
    const crop = pendingCrop();
    const onCropped = vi.fn();
    const user = userEvent.setup();
    const props = { aspect: 1, onCancel: vi.fn(), onCropped };
    const { rerender } = render(
      <ImageCropModal file={new File(['image'], 'gift.png', { type: 'image/png' })} {...props} />
    );

    await user.click(cropButton());
    rerender(
      <ImageCropModal file={new File(['other'], 'other.png', { type: 'image/png' })} {...props} />
    );
    expect(cropButton()).toBeEnabled();

    await crop.succeed();
    expect(onCropped).not.toHaveBeenCalled();
  });

  it('uploads the crop once, and puts it in the item, when nothing cancels it', async () => {
    const crop = pendingCrop();
    const upload = stubUpload();
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const user = await openCropOverItemModal({ onAdd });

    await user.click(cropButton());
    await crop.succeed(new Blob(['cropped']));
    expect(await screen.findByAltText('Item photo')).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith('/api/upload', expect.objectContaining({ method: 'POST' }));
    expect(await uploadedText(upload)).toBe('cropped');

    await user.click(screen.getByRole('button', { name: 'Add to list' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd.mock.calls[0][0].imageUrl).toBe(UPLOADED);
  });
});

describe('ImageCropModal — a new file while it is open', () => {
  // regression: handing the dialog another file (a paste while it's open) kept
  // the previous image's crop area until the cropper reported the new one, so
  // Crop & upload in that window cropped the new image with the old rectangle.
  it('regression: holds Crop & upload until the new file reports its area', () => {
    const props = { aspect: 1, onCancel: vi.fn(), onCropped: vi.fn() };
    const { rerender } = render(
      <ImageCropModal file={new File(['one'], 'one.png', { type: 'image/png' })} {...props} />
    );
    expect(cropButton()).toBeEnabled();

    cropperHeld.value = true;
    rerender(
      <ImageCropModal file={new File(['two'], 'two.png', { type: 'image/png' })} {...props} />
    );
    expect(cropButton()).toBeDisabled();

    cropperHeld.value = false;
    rerender(
      <ImageCropModal file={new File(['three'], 'three.png', { type: 'image/png' })} {...props} />
    );
    expect(cropButton()).toBeEnabled();
  });
});

describe('ImageUpload — a paste while an upload runs', () => {
  const paste = (file: File) => {
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', {
      value: { items: [{ type: file.type, getAsFile: () => file }] },
    });
    act(() => {
      document.dispatchEvent(e);
    });
    return e;
  };

  // regression: a paste was only ignored while the form was disabled, so image
  // B could start a second upload while A's ran: the control re-enabled when
  // the first answered and the field kept whichever answered last.
  it('regression: takes no second image while the first uploads, and re-enables once it answers', async () => {
    const crop = pendingCrop();
    let answer!: (body: unknown) => void;
    const upload = vi.fn(
      () =>
        new Promise((resolve) => {
          answer = (body) => resolve({ json: async () => body });
        })
    );
    vi.stubGlobal('fetch', upload);
    const onChange = vi.fn();
    render(<ImageUpload value={null} onChange={onChange} />);
    paste(new File(['a'], 'a.png', { type: 'image/png' }));
    const user = userEvent.setup();
    await user.click(cropButton());
    await crop.succeed(new Blob(['a']));
    expect(upload).toHaveBeenCalledTimes(1);

    paste(new File(['b'], 'b.png', { type: 'image/png' }));
    expect(screen.queryByRole('dialog', { name: 'Crop image' })).toBeNull();
    expect(screen.getByRole('button', { name: /uploading/i })).toBeDisabled();

    await act(async () => answer({ success: true, url: UPLOADED }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(UPLOADED);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /click to upload/i })).toBeEnabled();
  });
});
