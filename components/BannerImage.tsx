'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * Cover-image layer for wishlists (and reserved thumbnails). Uses next/image so
 * it routes through the server-side image optimizer — this loads images from
 * hosts that block direct hotlinking (which a plain <img> can't). Renders inside
 * a positioned, sized parent; on error it renders nothing so the gradient cover
 * underneath shows through.
 */
export default function BannerImage({
  src,
  alt = '',
  sizes = '100vw',
  priority = false,
  onError,
}: {
  src: string;
  alt?: string;
  sizes?: string;
  /** Set for above-the-fold hero images (LCP) so they load eagerly. */
  priority?: boolean;
  /** Called when the image fails to load, for a parent that paints its own fallback. */
  onError?: () => void;
}) {
  const [error, setError] = useState(false);
  if (error) return null;
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className="object-cover"
      onError={() => {
        setError(true);
        onError?.();
      }}
    />
  );
}
