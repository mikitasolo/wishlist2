'use client';

import Image from 'next/image';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * The image layer of a `Cover`, and of the upload preview. Uses next/image so
 * it routes through the server-side image optimizer — this loads images from
 * hosts that block direct hotlinking (which a plain <img> can't). Renders inside
 * a positioned, sized parent; on error it renders nothing and calls `onError`,
 * until `src` changes: a new URL (a replaced image) gets a fresh try. Don't
 * frame it by hand for a list or item image: `Cover` puts the gradient
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
  // Keyed on the URL, not a boolean: the upload preview keeps this mounted
  // when Replace swaps in a new URL.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // next/image runs `img.src = img.src` whenever its onError changes identity,
  // which restarts an animated image, so the handler it gets changes only with
  // `src`. The caller's onError (often an inline arrow) is read through a ref.
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    onErrorRef.current = onError;
  });
  const handleError = useCallback(() => {
    setFailedSrc(src);
    onErrorRef.current?.();
  }, [src]);
  if (failedSrc === src) return null;
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className="object-cover"
      onError={handleError}
    />
  );
}
