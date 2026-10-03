/**
 * The status tones: what each kind of meaning looks like (an item status, a
 * notice, a toast, a confirmation). The colours are the status tokens in
 * `app/globals.css` (`bg-success-fill`, `text-warning`, …); an item status
 * gets its tone from `statusMeta` (`lib/utils/itemStatus.ts`). Never colour a
 * status with raw palette classes (`emerald-*`, `amber-*`, `green-*`,
 * `blue-*`, `yellow-*`).
 */

/**
 * - `neutral`: nothing to say (available).
 * - `info`: proposed, and informational notices.
 * - `success`: reserved by you, the Reserve button, success toasts.
 * - `warning`: reserved by someone else, things that need the viewer's attention.
 * - `danger`: destructive actions and errors.
 * - `done`: received (`completed`). Neutral on purpose, so it can't be mistaken
 *   for "Reserved by you", which is green.
 * - `draft`: not published yet.
 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'done' | 'draft';

export interface ToneClasses {
  /** A badge's colours: a solid fill and its text (shape and size are the caller's). */
  badge: string;
  /** Coloured text on a surface (a stat tile's number, an icon). */
  text: string;
  /** An item card's border (and ring), replacing its default border colour. */
  card: string;
  /** A soft chip or button: the tone's tint with its text. */
  tint: string;
  /** A notice box: border, tint and text (shape and padding are the caller's). */
  notice: string;
}

// Every pair here clears 4.5:1 in both themes (the WIS-234 PR lists them).
export const TONE_CLASSES: Record<StatusTone, ToneClasses> = {
  neutral: {
    badge: 'border border-border bg-surface text-foreground',
    text: 'text-foreground',
    card: 'border-border',
    tint: 'bg-muted text-foreground',
    notice: 'border border-border bg-surface-2 text-foreground',
  },
  info: {
    badge: 'bg-info-fill text-white',
    text: 'text-info',
    card: 'border-info/60 ring-1 ring-info/30',
    tint: 'bg-info/12 text-info',
    notice: 'border border-info/20 bg-info/10 text-info',
  },
  success: {
    badge: 'bg-success-fill text-white',
    text: 'text-success',
    card: 'border-success/60 ring-1 ring-success/30',
    tint: 'bg-success/12 text-success',
    notice: 'border border-success/20 bg-success/10 text-success',
  },
  warning: {
    badge: 'bg-warning-fill text-white',
    text: 'text-warning',
    card: 'border-warning/60 ring-1 ring-warning/30',
    tint: 'bg-warning/15 text-warning',
    notice: 'border border-warning/30 bg-warning/10 text-warning',
  },
  danger: {
    badge: 'bg-danger-fill text-white',
    text: 'text-danger',
    card: 'border-danger/60 ring-1 ring-danger/30',
    tint: 'bg-danger/15 text-danger',
    notice: 'border border-danger/20 bg-danger/10 text-danger',
  },
  done: {
    badge: 'bg-foreground text-background',
    text: 'text-foreground',
    card: 'border-foreground/30',
    tint: 'bg-foreground/8 text-foreground',
    notice: 'border border-border-strong bg-surface-2 text-foreground',
  },
  draft: {
    badge: 'border border-dashed border-border-strong bg-surface-2 text-muted-foreground',
    text: 'text-muted-foreground',
    card: 'border-dashed border-border-strong',
    tint: 'bg-surface-2 text-muted-foreground',
    notice: 'border border-dashed border-border-strong bg-surface-2 text-muted-foreground',
  },
};
