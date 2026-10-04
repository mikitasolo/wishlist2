import type { ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import type { StatusMeta } from '@/lib/utils/itemStatus';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

/**
 * - `neutral`: a plain label on a surface or over an image (Most wanted, a count).
 * - `info`, `success`, `warning`, `danger`: a meaning's soft tint (Friends, a
 *   note that needs attention). Never an item status: that's `status`.
 * - `glass`: frosted, over a cover image (a list's visibility, Featured, a role).
 */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'glass';

/** sm: in a dense grid (`/items`), beside a heading (a count); md: on a card, by a title. */
export type BadgeSize = 'sm' | 'md';

/**
 * Over a cover image of any brightness (WIS-308): white text on a dark frost.
 * 60% black over a pure white photo composites to #666 (white on it: 5.7:1,
 * past AA's 4.5:1), and over a black one it's darker still. A light frost
 * (`bg-white/20`) fell to about 1:1 on a bright photo.
 */
export const GLASS = 'border border-white/20 bg-black/60 text-white shadow-sm backdrop-blur-md';

const TONES: Record<BadgeTone, string> = {
  neutral: TONE_CLASSES.neutral.badge,
  info: TONE_CLASSES.info.tint,
  success: TONE_CLASSES.success.tint,
  warning: TONE_CLASSES.warning.tint,
  danger: TONE_CLASSES.danger.tint,
  glass: GLASS,
};

/** `glass` darkened, for a cover that's been greyed out (an archived list's). */
export const GLASS_DIM = 'border border-white/20 bg-black/70 text-white shadow-sm backdrop-blur-md';

const SIZES: Record<BadgeSize, string> = {
  sm: 'gap-1 px-2 py-0.5',
  md: 'gap-1 px-2.5 py-1',
};

/**
 * A badge's classes, for a label that isn't a `Badge` but should look like one
 * (`OccasionLabel`, which lays out its own icon and date). Add the position.
 */
export function badgeClassName({
  tone = 'neutral',
  size = 'md',
  dim = false,
}: { tone?: BadgeTone; size?: BadgeSize; dim?: boolean } = {}) {
  const colours = tone === 'glass' && dim ? GLASS_DIM : TONES[tone];
  return `inline-flex flex-shrink-0 items-center rounded-full text-badge font-semibold ${SIZES[size]} ${colours}`;
}

type BadgeProps = {
  size?: BadgeSize;
  /** Position, a shadow over an image, a `capitalize`: never colours, which are the tone's. */
  className?: string;
} & (
  | {
      /**
       * An item status, as `statusMeta` (`lib/utils/itemStatus.ts`) gives it
       * for the viewer: its label, icon and solid fill. A status is only ever
       * shown this way, so it has one colour and one name everywhere.
       */
      status: StatusMeta;
      tone?: never;
      icon?: never;
      children?: never;
    }
  | {
      status?: never;
      tone?: BadgeTone;
      /** With `glass`: a darker frost, over a greyed-out cover (an archived list). */
      dim?: boolean;
      icon?: IconName;
      children: ReactNode;
    }
);

/**
 * A small rounded label: an item's status, a list's visibility over its cover,
 * a count beside a heading. Text is `text-badge` semibold with a 12px icon.
 */
export default function Badge({ size = 'md', className = '', ...rest }: BadgeProps) {
  if (rest.status) {
    const { status } = rest;
    return (
      <span
        data-tone={status.tone}
        className={`inline-flex flex-shrink-0 items-center rounded-full text-badge font-semibold ${SIZES[size]} ${status.classes.badge} ${className}`}
      >
        {status.icon && <Icon name={status.icon} size={12} className="flex-shrink-0" />}
        {status.label}
      </span>
    );
  }
  const { tone = 'neutral', dim, icon, children } = rest;
  return (
    <span className={`${badgeClassName({ tone, size, dim })} ${className}`}>
      {icon && <Icon name={icon} size={12} className="flex-shrink-0" />}
      {children}
    </span>
  );
}
