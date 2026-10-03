'use client';

import type { UsernameAvailability } from '@/lib/hooks/useUsernameAvailability';
import { TONE_CLASSES } from '@/lib/utils/itemStatus';

interface UsernameFieldProps {
  value: string;
  /** Called with the edited value, already lowercased. */
  onChange: (value: string) => void;
  /** From `useUsernameAvailability`; `idle` shows no status. */
  availability: UsernameAvailability;
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/**
 * The `@username` input with its live availability and the format hint,
 * shared by the settings page and the welcome page so both follow one set of
 * rules. The parent owns the value and the availability (it gates its save
 * button on `ok`).
 */
export default function UsernameField({
  value,
  onChange,
  availability,
  id = 'username',
  disabled = false,
  autoFocus = false,
}: UsernameFieldProps) {
  return (
    <>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        Username
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3 field-focus">
        <span className="text-muted-foreground">@</span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-11 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-hidden"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          disabled={disabled}
          autoFocus={autoFocus}
        />
        <span className="flex-shrink-0 text-sm" aria-live="polite">
          {availability === 'checking' && <span className="text-muted-foreground">Checking…</span>}
          {availability === 'ok' && <span className={TONE_CLASSES.success.text}>Available</span>}
          {availability === 'taken' && (
            <span className="text-red-600 dark:text-red-400">Taken</span>
          )}
          {availability === 'invalid' && (
            <span className="text-red-600 dark:text-red-400">Invalid</span>
          )}
        </span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        3–20 characters, starting with a letter. Letters, numbers, and underscores only.
      </p>
    </>
  );
}
