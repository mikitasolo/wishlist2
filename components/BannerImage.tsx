'use client';

import Image from 'next/image';
import { useState } from 'react';

/**
 * The image layer of a `Cover`, and of the upload preview. Uses next/image so
 * it routes through the server-side image optimizer — this loads images from
 * hosts that block direct hotlinking (which a plain <img> can't). Renders inside
 * a positioned, sized parent; on error it renders nothing and calls `onError`.
 * Don't frame it by hand for a list or item image: `Cover` puts the gradient
 * placeholder back when the image fails.
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
