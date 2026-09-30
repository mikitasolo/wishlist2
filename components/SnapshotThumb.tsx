'use client';

import Cover from '@/components/Cover';

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
  const size = small ? 'h-11 w-11' : 'h-16 w-16';
  return (
    <Cover
      src={src}
      seed={seed}
      alt={alt}
      sizes="64px"
      className={`relative ${size} flex-shrink-0 overflow-hidden rounded-xl bg-surface-2`}
    />
  );
}
