'use client';

import Icon from '@/components/Icon';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

/** Where a save of one setting is: on its way, landed (shown for a moment), or refused. */
export type SaveState = { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

/**
 * The inline word beside a setting that saves as it's changed: "Saving…",
 * "Saved ✓" for about two seconds, or why it couldn't be saved. A live region
 * that's always there, so a screen reader hears each change of it.
 */
export default function SaveNote({
  state,
  className = '',
}: {
  state?: SaveState;
  className?: string;
}) {
  return (
    <span aria-live="polite" className={`inline-flex items-center gap-1 text-xs ${className}`}>
      {state?.kind === 'saving' && <span className="text-muted-foreground">Saving…</span>}
      {state?.kind === 'saved' && (
        <span className={`inline-flex items-center gap-1 font-medium ${TONE_CLASSES.success.text}`}>
          <Icon name="check" size={12} />
          Saved
        </span>
      )}
      {state?.kind === 'error' && (
        <span className={`font-medium ${TONE_CLASSES.danger.text}`}>{state.message}</span>
      )}
    </span>
  );
}
