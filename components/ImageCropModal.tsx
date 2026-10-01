'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

  useBodyScrollLock(true);

  // Focus starts on the close button and stays inside while it's open, even
  // over the item modal whose form holds it, then goes back to what opened it.
  // While the crop runs (its buttons disabled), it's held on the panel.
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(true, dialogRef, undefined, { busy: working });

  // Load the selected file into an object URL for the cropper.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const onCropComplete = useCallback((_area: unknown, areaPx: PixelCrop) => {
    setAreaPixels(areaPx);
  }, []);

  const confirm = async () => {
    if (!src || !areaPixels) return;
    setWorking(true);
    try {
      const blob = await getCroppedBlob(src, areaPixels);
      onCropped(blob);
    } catch {
      setWorking(false);
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
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">Crop image</h2>
          <button
            onClick={onCancel}
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
            onClick={onCancel}
            disabled={working}
            className="h-10 rounded-xl bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50"
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
