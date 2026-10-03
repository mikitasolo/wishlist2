'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import BannerImage from './BannerImage';
import ImageCropModal from './ImageCropModal';
import Button from './Button';
import Spinner from './Spinner';

interface ImageUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  disabled?: boolean;
  /** Crop aspect ratio (width / height) matching where the image renders. */
  aspect?: number;
  /** Render as a compact circular control (avatars). Forces a 1:1 round crop. */
  circle?: boolean;
  /**
   * Render as a 72px thumbnail row ("Add photo", or the thumbnail with Replace
   * and Remove), for a form where the photo is one field among others (the
   * item form). An image dropped anywhere on the page, or pasted, is taken too.
   */
  compact?: boolean;
}

/**
 * Lets the user pick an image (drop / paste / click), crop it to the target
 * aspect ratio, then uploads the cropped result to Vercel Blob (via /api/upload)
 * and returns its URL through onChange.
 */
export default function ImageUpload({
  value,
  onChange,
  disabled = false,
  aspect = 16 / 9,
  circle = false,
  compact = false,
}: ImageUploadProps) {
  // Avatars crop square and display round.
  const effectiveAspect = circle ? 1 : aspect;
  const cropShape = circle ? 'round' : 'rect';
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLButtonElement>(null);
  // Set by an upload into the empty drop zone, which the preview replaces.
  const focusPreview = useRef(false);

  // Open the cropper for a chosen file.
  const handleFile = useCallback((file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    setPendingFile(file);
  }, []);

  const uploadBlob = useCallback(
    async (blob: Blob) => {
      setError(null);
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append('file', blob, 'upload.webp');
        const res = await fetch('/api/upload', { method: 'POST', body: fd });
        const result = await res.json();
        if (result.success) {
          focusPreview.current = !value;
          onChange(result.url);
        } else setError(result.error || 'Upload failed.');
      } catch {
        setError('Upload failed.');
      } finally {
        setUploading(false);
      }
    },
    [onChange, value]
  );

  // The crop dialog hands focus back to the drop zone that opened it, but an
  // upload into it swaps the drop zone for the preview, and focus would drop
  // to <body> with it: move it to the preview's Replace instead.
  useEffect(() => {
    if (!value || !focusPreview.current) return;
    focusPreview.current = false;
    const focused = document.activeElement;
    if (!focused || focused === document.body) replaceRef.current?.focus();
  }, [value]);

  // Paste an image from the clipboard anywhere while this control is mounted.
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            handleFile(f);
            break;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [disabled, handleFile]);

  // The compact row has no drop zone to aim at: a file dropped anywhere is
  // taken, as a pasted one is (the dialog around it is the target).
  useEffect(() => {
    if (!compact || disabled) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes('Files');
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(true);
    };
    const onDragEnd = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) handleFile(f);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragleave', onDragEnd);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('dragleave', onDragEnd);
      document.removeEventListener('drop', onDrop);
    };
  }, [compact, disabled, handleFile]);

  const openPicker = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />

      {compact ? (
        <div className="flex items-center gap-4">
          <div
            className={`relative flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center overflow-hidden rounded-xl transition-colors ${
              value
                ? 'border border-border bg-surface-2'
                : dragging
                  ? 'border-2 border-dashed border-primary-500 bg-primary-500/12'
                  : 'border-2 border-dashed border-border-strong hover:bg-surface-hover'
            } ${disabled ? 'opacity-60' : ''}`}
          >
            {value ? (
              <BannerImage src={value} alt="Item photo" sizes="72px" />
            ) : (
              <Icon name="image" size={18} className="text-muted-foreground" />
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                <Spinner className="text-white" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              ref={replaceRef}
              type="button"
              variant="secondary"
              size="sm"
              icon={value ? undefined : 'plus'}
              onClick={openPicker}
              disabled={disabled || uploading}
            >
              {value ? 'Replace' : 'Add photo'}
            </Button>
            {value && (
              <Button
                type="button"
                variant="danger-ghost"
                size="sm"
                onClick={() => onChange(null)}
                disabled={disabled || uploading}
              >
                Remove
              </Button>
            )}
            {uploading && (
              <span className="inline-flex h-9 items-center text-sm text-muted-foreground">
                Uploading…
              </span>
            )}
          </div>
        </div>
      ) : circle ? (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={openPicker}
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) handleFile(f);
            }}
            disabled={disabled || uploading}
            aria-label={value ? 'Replace photo' : 'Upload photo'}
            className={`relative flex h-24 w-24 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-center transition-colors ${
              value
                ? 'border border-border bg-surface-2'
                : dragging
                  ? 'border-2 border-dashed border-primary-500 bg-primary-500/12'
                  : 'border-2 border-dashed border-border-strong hover:bg-surface-hover'
            } disabled:opacity-60`}
          >
            {value ? (
              <BannerImage src={value} alt="Profile photo" sizes="96px" />
            ) : (
              <Icon name="image" size={28} className="text-muted-foreground" />
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                <Spinner className="text-white" />
              </div>
            )}
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={openPicker}
                disabled={disabled || uploading}
              >
                {value ? 'Replace' : 'Upload'}
              </Button>
              {value && (
                <Button
                  type="button"
                  variant="danger-ghost"
                  size="sm"
                  onClick={() => onChange(null)}
                  disabled={disabled || uploading}
                >
                  Remove
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              Drag &amp; drop, paste, or click. PNG, JPG, WebP or GIF · up to 4MB.
            </p>
          </div>
        </div>
      ) : value ? (
        <div
          className="relative mx-auto w-full overflow-hidden rounded-xl border border-border bg-surface-2"
          // Bound by WIDTH, not height: a `max-height` clamp fights `aspect-ratio` and the box
          // goes off-ratio once the aspect-derived height would exceed it (a 1:1 in a wide modal,
          // a 16:9 in a wide panel). Capping width at height-budget × aspect keeps the ratio exact
          // for any aspect while holding the preview to ~18rem tall.
          style={{ aspectRatio: String(aspect), maxWidth: `${18 * aspect}rem` }}
        >
          <BannerImage src={value} alt="Uploaded image" sizes="(max-width: 640px) 100vw, 40rem" />
          <div className="absolute right-2 top-2 flex gap-1.5">
            <button
              ref={replaceRef}
              type="button"
              onClick={openPicker}
              disabled={disabled || uploading}
              className="rounded-lg bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-black/60 disabled:opacity-50"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled || uploading}
              className="rounded-lg bg-black/45 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md transition-colors hover:bg-black/60 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
              <Spinner className="text-white" />
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          disabled={disabled || uploading}
          // Same ratio-preserving bound as the filled preview (width-capped, not height-clamped).
          style={{ aspectRatio: String(aspect), maxWidth: `${18 * aspect}rem` }}
          className={`mx-auto flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition-colors ${
            dragging
              ? 'border-primary-500 bg-primary-500/12'
              : 'border-border-strong hover:bg-surface-hover'
          } disabled:opacity-60`}
        >
          {uploading ? (
            <>
              <Spinner />
              <span className="text-sm text-muted-foreground">Uploading…</span>
            </>
          ) : (
            <>
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
                <Icon name="image" size={18} />
              </span>
              <span className="text-sm font-medium text-foreground">
                Drag &amp; drop, paste, or click to upload
              </span>
              <span className="text-xs text-muted-foreground">
                PNG, JPG, WebP or GIF · up to 4MB
              </span>
            </>
          )}
        </button>
      )}

      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}

      {pendingFile && (
        <ImageCropModal
          file={pendingFile}
          aspect={effectiveAspect}
          cropShape={cropShape}
          onCancel={() => setPendingFile(null)}
          onCropped={(blob) => {
            setPendingFile(null);
            uploadBlob(blob);
          }}
        />
      )}
    </div>
  );
}
