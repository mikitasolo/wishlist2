'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import Icon from './Icon';
import { getCroppedBlob, type PixelCrop } from '@/lib/utils/cropImage';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

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

  useBodyScrollLock(true);

  // Focus starts on the close button and stays inside while it's open, even
  // over the item modal whose form holds it, then goes back to what opened it.
  // While the crop runs (Crop & upload disabled), it's held on the panel if
  // Crop & upload had it.
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(true, dialogRef, undefined, { busy: working });

  // Load the selected file into an object URL for the cropper. A crop of the
  // file this replaces, or of the last one when the dialog closes, is dropped.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
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
  // cancels only the crop, not the item or create-wishlist modal it opened in.
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

  return (
    <div
      className="animate-fade-in fixed left-0 right-0 top-0 z-[80] flex h-[100dvh] items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="animate-dialog-in flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">
            Crop image
          </h2>
          {/* A plain button: the dialog sits inside the item or wishlist form. */}
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* Cropper stage */}
        <div className="relative mx-5 mt-4 h-72 overflow-hidden rounded-xl bg-surface-2">
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
        <div className="flex items-center gap-3 px-5 pt-4">
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

        {/* Actions */}
        <div className="flex justify-end gap-2 p-5">
          <button
            type="button"
            onClick={cancel}
            className="h-10 rounded-xl bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={working || !areaPixels}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)] transition-all hover:bg-primary-500 active:scale-[0.98] disabled:opacity-50"
          >
            {working ? 'Uploading…' : 'Crop & upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
