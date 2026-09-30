'use client';

import { useState, type ReactNode } from 'react';
import BannerImage from '@/components/BannerImage';
import { coverGradient } from '@/lib/utils/cover';

/**
 * The cover of a wishlist or item: a frame that shows its image, or the gradient
 * placeholder when there is none or it fails to load (a freed blob, a dead
 * external URL). The gradient is the frame's own background rather than a layer
 * inside it, so it still reaches under a bordered frame's border.
 *
 * Put this where the positioned, sized box goes: `className` must make it
 * `relative` and give it a size, because the image fills it. `children` are
 * overlays (badges, a shade, notes) and need their own positioning to paint on
 * top of the image.
 */
export default function Cover({
  src,
  seed,
  alt = '',
  sizes,
  priority,
  link,
  className,
  children,
}: {
  src: string | null | undefined;
  /** Picks the placeholder gradient (e.g. the list's or item's id), so it never changes. */
  seed: string;
  alt?: string;
  sizes?: string;
  priority?: boolean;
  /**
   * Makes the frame a link to an external page, opened in a new tab (an item's
   * product page). Part of the cover rather than wrapped around it, so when a
   * card drops the link to show its notes, the cover stays mounted and still
   * knows its image is broken instead of trying it again.
   */
  link?: { href: string; label: string };
  className?: string;
  children?: ReactNode;
}) {
  // Keyed on the URL, so an edit that replaces a broken image shows the new one.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = !!src && failedSrc !== src;
  const style = { background: showImage ? undefined : coverGradient(seed) };
  const content = (
    <>
      {showImage && (
        <BannerImage
          src={src}
          alt={alt}
          sizes={sizes}
          priority={priority}
          onError={() => setFailedSrc(src)}
        />
      )}
      {children}
    </>
  );
  return link ? (
    <a
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={link.label}
      className={className}
      style={style}
    >
      {content}
    </a>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}
