// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emulateFocusFixup } from '../focusFixup';

// react-easy-crop needs real image loading and layout; a stand-in reports a
// crop area as soon as it mounts, as the real one does once the image loads,
// and is a Tab stop, as the real crop area is (it moves with the arrow keys).
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

const itemModal = () => screen.getByRole('dialog', { name: 'Add New Item' });
const cropDialog = () => screen.getByRole('dialog', { name: 'Crop image' });
const inCrop = () => within(cropDialog());
const dropZone = () => screen.getByRole('button', { name: /click to upload/i });

/**
 * Opens the Add Item modal and picks an image in its form, as a click on the
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

  const input = itemModal().querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['image'], 'gift.png', { type: 'image/png' });
  fireEvent.change(input, { target: { files: [file] } });
  expect(cropDialog()).toBeInTheDocument();
  // The stand-in cropper has reported its area, so Crop & upload is enabled.
  expect(inCrop().getByRole('button', { name: 'Crop & upload' })).toBeEnabled();
  return user;
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
    const addItem = screen.getByRole('button', { name: 'Add Item' });
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
    expect(screen.getByRole('alertdialog', { name: 'Discard Changes?' })).toBeInTheDocument();
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

  /** A crop that stays in flight until the test settles it. */
  function pendingCrop() {
    let settle!: { resolve: (blob: Blob) => void; reject: (error: Error) => void };
    getCroppedBlob.mockImplementation(
      () =>
        new Promise<Blob>((resolve, reject) => {
          settle = { resolve, reject };
        })
    );
    return {
      succeed: () => act(async () => settle.resolve(new Blob(['cropped']))),
      fail: () => act(async () => settle.reject(new Error('Could not crop'))),
    };
  }

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
    expect(opener).toHaveTextContent('Uploading…');
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
