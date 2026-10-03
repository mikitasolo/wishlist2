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
}

/**
 * A read that failed in a way that may not last (a 5xx, a network error: see
 * `readResource`), in place of what it would have shown, with Try again. Never
 * for a refusal (missing, or hidden from the viewer), which trying again won't
 * change.
 */
export default function LoadError({
  title,
  onRetry,
  level = 2,
  body = 'Check your connection and try again.',
}: LoadErrorProps) {
  return (
    <StatePanel
      icon="alert"
      tone="error"
      title={title}
      level={level}
      body={body}
      actions={<Button onClick={onRetry}>Try again</Button>}
    />
  );
}
