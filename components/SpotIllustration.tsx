import type { ReactNode } from 'react';
import type { IconName } from '@/components/Icon';

/**
 * The spot illustrations (WIS-408): a small set of inline SVG drawings for
 * empty states, and anywhere else a screen wants a friendlier picture than an
 * icon (the landing page imports them from here too). One look: a 96 grid, one
 * 2.5 stroke with round caps and joins, the accent for the outline and its
 * soft tint for fills, plus one warm detail in `accent2`. Both come from the
 * theme tokens, so dark mode follows with no per-theme code. No raw palette
 * classes, and nothing here carries text: the picture is decoration
 * (`aria-hidden`), the title beside it says it.
 */
export type IllustrationName = 'gift' | 'list' | 'people' | 'search' | 'link-off' | 'bell';

/** The accent outline, shared by every drawing. */
const LINE = 'fill-none stroke-accent stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]';
/** The accent's soft tint, for a shape that holds the eye. */
const TINT =
  'fill-primary-500/12 stroke-accent stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]';
/** The one warm detail. */
const WARM = 'fill-none stroke-accent2 stroke-[2.5] [stroke-linecap:round] [stroke-linejoin:round]';
const WARM_FILL = 'fill-accent2 stroke-none';

const DRAWINGS: Record<IllustrationName, ReactNode> = {
  gift: (
    <>
      <rect x="18" y="42" width="60" height="38" rx="6" className={TINT} />
      <rect x="12" y="30" width="72" height="14" rx="5" className={TINT} />
      <path d="M48 30v50" className={LINE} />
      <path d="M48 30c-4-12-20-14-20-6 0 6 12 6 20 6Z" className={WARM} />
      <path d="M48 30c4-12 20-14 20-6 0 6-12 6-20 6Z" className={WARM} />
      <path d="M80 12v8M76 16h8" className={WARM} />
    </>
  ),
  list: (
    <>
      <rect x="20" y="12" width="56" height="72" rx="8" className={TINT} />
      <path d="M32 34h32M32 48h32M32 62h18" className={LINE} />
      <path d="M84 62v14M77 69h14" className={WARM} />
    </>
  ),
  people: (
    <>
      <circle cx="36" cy="34" r="10" className={TINT} />
      <path d="M16 78c0-12 9-20 20-20s20 8 20 20Z" className={TINT} />
      <circle cx="64" cy="42" r="8" className={LINE} />
      <path d="M62 60c1-.5 2-.7 3-.7 9 0 15 7 15 18H64" className={LINE} />
      <path d="M68 12c-3-4-9-1-6 4 1.5 2.5 6 5 6 5s4.5-2.5 6-5c3-5-3-8-6-4Z" className={WARM} />
    </>
  ),
  search: (
    <>
      <circle cx="42" cy="42" r="24" className={TINT} />
      <path d="M60 60l22 22" className={LINE} />
      <path d="M32 40c2-5 6-8 11-8" className={WARM} />
      <circle cx="80" cy="18" r="2.5" className={WARM_FILL} />
      <circle cx="16" cy="78" r="2.5" className={WARM_FILL} />
    </>
  ),
  'link-off': (
    <>
      <path d="M40 56l-8 8a12 12 0 0 1-17-17l12-12a12 12 0 0 1 17 0" className={LINE} />
      <path d="M56 40l8-8a12 12 0 0 1 17 17L69 61a12 12 0 0 1-17 0" className={LINE} />
      <path d="M44 20l-4 10M20 44l10-4M52 76l4-10M76 52l-10 4" className={WARM} />
    </>
  ),
  bell: (
    <>
      <path d="M24 66V44a24 24 0 0 1 48 0v22l6 6H18Z" className={TINT} />
      <path d="M40 78a8 8 0 0 0 16 0" className={LINE} />
      <path d="M48 14v6" className={LINE} />
      <circle cx="72" cy="22" r="6" className={WARM_FILL} />
    </>
  ),
};

/**
 * The illustration an icon stands for, where one fits; the rest (an alert, a
 * lock, a mail…) keep their icon chip. It follows the screen's meaning, not
 * the icon's shape: a package is still "things", so it draws the gift.
 */
const ILLUSTRATION_FOR_ICON: Partial<Record<IconName, IllustrationName>> = {
  gift: 'gift',
  package: 'gift',
  list: 'list',
  users: 'people',
  search: 'search',
  'link-off': 'link-off',
  bell: 'bell',
};

export function illustrationForIcon(icon: IconName): IllustrationName | undefined {
  return ILLUSTRATION_FOR_ICON[icon];
}

export default function SpotIllustration({
  name,
  size = 96,
  className = '',
}: {
  name: IllustrationName;
  /** Rendered width and height in px (the drawing scales). */
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 96 96"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {DRAWINGS[name]}
    </svg>
  );
}
