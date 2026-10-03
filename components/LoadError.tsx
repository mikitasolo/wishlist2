'use client';

import type { ReactNode } from 'react';
import Button from '@/components/Button';
import StatePanel from '@/components/StatePanel';

interface LoadErrorProps {
  /** What couldn't be loaded: "Couldn’t load this wishlist". */
  title: ReactNode;
  /** Reads it again. */
  onRetry: () => void;
  /** The title's heading level (see `StatePanel`). */
  level?: 1 | 2 | 3;
  body?: ReactNode;
  /** Smaller, inside a dialog (see `StatePanel`). */
  compact?: boolean;
}

/**
 * A read that failed in a way that may not last (a 5xx, a network error: see
 * `readResource`), in place of what it would have shown, with Try again. Never
 * for a refusal (missing, or hidden from the viewer), which trying again won't
 * change.
 *
 * A page shows it when its first load fails, instead of its empty state (which
 * would claim there's nothing there) and without a toast. A later read that
 * fails (a poll, a refresh) keeps what the page already shows.
 */
export default function LoadError({
  title,
  onRetry,
  level = 2,
  body = 'Check your connection and try again.',
  compact = false,
}: LoadErrorProps) {
  return (
    <StatePanel
      icon="alert"
      tone="error"
      title={title}
      level={level}
      body={body}
      compact={compact}
      actions={
        <Button size={compact ? 'sm' : 'lg'} onClick={onRetry}>
          Try again
        </Button>
      }
    />
  );
}
