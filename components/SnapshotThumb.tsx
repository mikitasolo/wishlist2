'use client';

import { useState } from 'react';
import BannerImage from '@/components/BannerImage';
import { coverGradient } from '@/lib/utils/cover';

/**
 * The square thumbnail of a reservation or gift-log snapshot on `/booked`. Shows
 * the snapshot's image, or the gradient placeholder when there is none or it
 * fails to load. The latter covers reservations made before snapshot blobs
 * existed (or whose copy failed): they still share the item's blob, which breaks
 * once the owner deletes the item or replaces its image.
 */
export default function SnapshotThumb({
  src,
  alt,
  seed,
  small = false,
}: {
  src: string | null;
  alt: string;
  /** Picks the placeholder gradient, so a row keeps the same one across renders. */
  seed: string;
  small?: boolean;
}) {
  // Keyed on the URL, so a row whose image changes gets another try.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const size = small ? 'h-11 w-11' : 'h-16 w-16';
  return (
    <div
      className={`relative ${size} flex-shrink-0 overflow-hidden rounded-xl bg-surface-2`}
      style={{ background: showImage ? undefined : coverGradient(seed) }}
    >
      {showImage && (
        <BannerImage src={src} alt={alt} sizes="64px" onError={() => setFailedSrc(src)} />
      )}
    </div>
  );
}
