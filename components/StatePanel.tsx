import type { ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';

interface StatePanelProps {
  icon: IconName;
  /** `error` for something that went wrong (a red icon), `neutral` otherwise. */
  tone?: 'neutral' | 'error';
  title: ReactNode;
  /**
   * The title's heading level: 1 when the panel is all the page has to show
   * (a list that isn't available), 2 or 3 inside a page's own content.
   */
  level?: 1 | 2 | 3;
  /** One or two short lines under the title. */
  body?: ReactNode;
  /** The way on: a button or link or two (the first is the primary one). */
  actions?: ReactNode;
  /** Anything that goes between the body and the actions, e.g. a search field. */
  children?: ReactNode;
  /** Smaller, for a panel inside a dialog rather than on a page. */
  compact?: boolean;
}

const iconTones = {
  neutral: 'bg-primary-500/12 text-accent dark:text-primary-300',
  error: 'bg-red-500/12 text-red-600 dark:text-red-400',
};

/**
 * A centred "this is where things stand" panel: an icon, a title, a line or
 * two and what to do next. For a page that can't show what was asked for (a
 * list or profile that isn't available, a route that doesn't exist, a failed
 * load: see `LoadError`). Presentational only, and no client component, so a
 * server component can render it too.
 */
export default function StatePanel({
  icon,
  tone = 'neutral',
  title,
  level = 2,
  body,
  actions,
  children,
  compact = false,
}: StatePanelProps) {
  const Heading = `h${level}` as const;
  return (
    <div
      className={`flex flex-col items-center px-4 text-center ${compact ? 'py-6' : 'py-16 sm:py-24'}`}
    >
      <span
        className={`inline-flex items-center justify-center ${
          compact ? 'mb-3 h-10 w-10 rounded-xl' : 'mb-5 h-14 w-14 rounded-2xl'
        } ${iconTones[tone]}`}
      >
        <Icon name={icon} size={compact ? 20 : 28} />
      </span>
      <Heading
        className={`max-w-lg font-semibold tracking-tight text-foreground [overflow-wrap:anywhere] ${
          compact ? 'text-base' : 'text-xl sm:text-2xl'
        }`}
      >
        {title}
      </Heading>
      {body && (
        <p
          className={`mx-auto max-w-md text-muted-foreground ${compact ? 'mt-1 text-sm' : 'mt-2 text-[15px]'}`}
        >
          {body}
        </p>
      )}
      {children && <div className="mt-6 w-full max-w-md text-left">{children}</div>}
      {actions && (
        <div
          className={`flex flex-wrap items-center justify-center gap-3 ${compact ? 'mt-4' : 'mt-7'}`}
        >
          {actions}
        </div>
      )}
    </div>
  );
}
