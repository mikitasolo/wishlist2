import type { ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import SpotIllustration, { illustrationForIcon } from '@/components/SpotIllustration';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

/**
 * - `default`: an invitation to start (no lists yet, no activity yet): the accent chip.
 * - `muted`: a quieter "nothing here" (a filter that hides everything, a
 *   private profile, nothing shared yet).
 * - `error`: something went wrong (a failed read: see `LoadError`).
 */
export type EmptyStateTone = 'default' | 'muted' | 'error';

interface EmptyStateProps {
  icon: IconName;
  title: ReactNode;
  /** One or two short lines under the title. */
  body?: ReactNode;
  /** The way on: a button or link or two, the first the primary one. */
  actions?: ReactNode;
  tone?: EmptyStateTone;
  /**
   * The title's heading level: 1 when the state is all the page has to show
   * (a list that isn't available, a failed load of the whole page), 2 or 3
   * inside a page's own content (the default).
   */
  level?: 1 | 2 | 3;
  /** Anything that goes between the body and the actions, e.g. a search field. */
  children?: ReactNode;
  /**
   * In a dashed frame, where the content it stands in for would be (a grid,
   * a list). `false` for a state that is the whole page (not found, a failed
   * load), which stands on the page itself.
   */
  framed?: boolean;
  /** Smaller, for a state inside a dialog rather than on a page. */
  compact?: boolean;
  className?: string;
}

const CHIP_TONES: Record<EmptyStateTone, string> = {
  default: 'bg-primary-500/12 text-accent',
  muted: 'bg-muted text-muted-foreground',
  error: TONE_CLASSES.danger.tint,
};

/**
 * Where there's nothing to show, or what was asked for can't be shown: an icon
 * chip, a title, a line or two, and what to do next. Every empty page, list,
 * grid and search is one of these, and so is a page that can't show what was
 * asked for (`LoadError` is its `error` tone with Try again). Presentational
 * only, and no client component, so a server component can render it too.
 *
 * An empty state is a claim about the user's data: show it only after a read
 * that succeeded, and `LoadError` after one that failed.
 */
export default function EmptyState({
  icon,
  title,
  body,
  actions,
  tone = 'default',
  level = 3,
  children,
  framed = true,
  compact = false,
  className = '',
}: EmptyStateProps) {
  // A spot illustration where the icon has one; an error, and an icon with none, keep the chip.
  const illustration = tone === 'error' ? undefined : illustrationForIcon(icon);
  const Heading = `h${level}` as const;
  const padding = compact ? 'py-6' : framed ? 'py-16 sm:py-20' : 'py-16 sm:py-24';
  return (
    <div
      className={`flex flex-col items-center px-4 text-center ${padding} ${
        framed ? 'rounded-3xl border border-dashed border-border-strong' : ''
      } ${className}`}
    >
      {illustration ? (
        <SpotIllustration
          name={illustration}
          size={compact ? 48 : 96}
          className={`${compact ? 'mb-2' : 'mb-4'} ${tone === 'muted' ? 'opacity-70' : ''}`}
        />
      ) : (
        <span
          className={`inline-flex items-center justify-center ${
            compact ? 'mb-3 h-10 w-10 rounded-xl' : 'mb-5 h-14 w-14 rounded-2xl'
          } ${CHIP_TONES[tone]}`}
        >
          <Icon name={icon} size={compact ? 18 : 28} />
        </span>
      )}
      <Heading
        className={`max-w-lg font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] ${
          compact ? 'text-base' : level === 1 ? 'text-xl sm:text-2xl' : 'text-xl'
        }`}
      >
        {title}
      </Heading>
      {body && (
        <p
          className={`mx-auto max-w-md text-muted-foreground ${compact ? 'mt-1 text-sm' : 'mt-2 text-body'}`}
        >
          {body}
        </p>
      )}
      {children && <div className="mt-6 w-full max-w-md text-left">{children}</div>}
      {actions && (
        <div
          className={`flex flex-wrap items-center justify-center gap-3 ${compact ? 'mt-4' : 'mt-6'}`}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
