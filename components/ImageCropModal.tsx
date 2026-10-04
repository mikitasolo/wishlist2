'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import Icon from './Icon';
import BaseModal from './BaseModal';
import Button from './Button';
import { getCroppedBlob, type PixelCrop } from '@/lib/utils/cropImage';

interface ImageCropModalProps {
  file: File;
  /** Target aspect ratio (width / height) matching the render container. */
  aspect: number;
  /** 'round' shows a circular crop guide (for avatars). */
  cropShape?: 'rect' | 'round';
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
}

export default function ImageCropModal({
  file,
  aspect,
  cropShape = 'rect',
  onCancel,
  onCropped,
}: ImageCropModalProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState<PixelCrop | null>(null);
  const [working, setWorking] = useState(false);
  // The crop in flight. Its result is handed on only if it's still this one:
  // cancelling drops it (so cancel is instant, instead of waiting for the
  // crop), and so does the dialog closing, or being handed another file (a
  // paste while it's open). The image the user moved on from would otherwise
  // be uploaded, and put in the form, all the same.
  const cropRun = useRef<object | null>(null);
  const endCrop = useCallback(() => {
    cropRun.current = null;
    setWorking(false);
  }, []);

  const titleId = useId();

  // Load the selected file into an object URL for the cropper. A crop of the
  // file this replaces, or of the last one when the dialog closes, is dropped.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    // The previous image's crop doesn't fit this one: keep Crop & upload held
    // until the cropper reports the new image's area.
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setAreaPixels(null);
    return () => {
      URL.revokeObjectURL(url);
      endCrop();
    };
  }, [file, endCrop]);

  // Every way out (the close button, Cancel, Escape) drops the crop in flight.
  const cancel = useCallback(() => {
    endCrop();
    onCancel();
  }, [endCrop, onCancel]);

  // Capture phase + stopImmediatePropagation, as in ConfirmDialog: Escape
  // cancels only the crop, not the item or create-wishlist modal it opened in
  // (whose own Escape listener, like BaseModal's here, never sees the key).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      cancel();
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, [cancel]);

  const onCropComplete = useCallback((_area: unknown, areaPx: PixelCrop) => {
    setAreaPixels(areaPx);
  }, []);

  const confirm = async () => {
    if (!src || !areaPixels) return;
    const run = {};
    cropRun.current = run;
    setWorking(true);
    try {
      const blob = await getCroppedBlob(src, areaPixels);
      if (cropRun.current !== run) return; // dropped meanwhile
      onCropped(blob);
    } catch {
      // A dropped crop has nothing left to end, and may have a newer one after it.
      if (cropRun.current === run) endCrop();
    }
  };

  // Rendered in the item or create-wishlist form, but portalled to <body> by
  // BaseModal, so it stacks over that dialog (opened after it) and its
  // buttons are outside the form. Focus starts on the close button and stays
  // inside while it's open, then goes back to what opened it. While the crop
  // runs (Crop & upload disabled), it's held on the panel if Crop & upload had
  // it, and every way out still works, dropping the crop. A click on the
  // backdrop does nothing, as before: a drag that ends off the image keeps it.
  return (
    <BaseModal
      isOpen
      onClose={cancel}
      title="Crop image"
      titleId={titleId}
      closeLabel="Cancel"
      closeOnBackdrop={false}
      busy={working}
      footer={
        <>
          <Button variant="cancel" size="md" onClick={cancel}>
            Cancel
          </Button>
          <Button size="md" onClick={confirm} disabled={working || !areaPixels}>
            {working ? 'Uploading…' : 'Crop & upload'}
          </Button>
        </>
      }
    >
      {/* Cropper stage */}
      <div className="relative h-72 overflow-hidden rounded-xl bg-surface-2">
        {src && (
          <Cropper
            image={src}
            crop={crop}
            zoom={zoom}
            aspect={aspect}
            cropShape={cropShape}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            showGrid={cropShape !== 'round'}
          />
        )}
      </div>

      {/* Zoom control */}
      <div className="flex items-center gap-3 pt-4">
        <Icon name="image" size={16} className="flex-shrink-0 text-muted-foreground" />
        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          className="h-1 w-full cursor-pointer accent-primary-600"
        />
      </div>
    </BaseModal>
  );
}
