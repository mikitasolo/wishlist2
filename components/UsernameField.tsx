'use client';

import Field from '@/components/Field';
import Input from '@/components/Input';
import type { UsernameAvailability } from '@/lib/hooks/useUsernameAvailability';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

interface UsernameFieldProps {
  value: string;
  /** Called with the edited value, already lowercased. */
  onChange: (value: string) => void;
  /** From `useUsernameAvailability`; `idle` shows no status. */
  availability: UsernameAvailability;
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** The account's current username; once the field differs, the helper warns that the link changes. */
  savedUsername?: string | null;
  placeholder?: string;
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
  savedUsername = null,
  placeholder,
}: UsernameFieldProps) {
  const changing = !!savedUsername && value !== '' && value !== savedUsername;
  return (
    <Field
      label="Username"
      id={id}
      helper={
        changing
          ? `3–20 characters, starting with a letter. Letters, numbers, and underscores only. Your profile link becomes …/users/${value}. Links you've already shared will stop working.`
          : '3–20 characters, starting with a letter. Letters, numbers, and underscores only.'
      }
    >
      <Input
        leading="@"
        trailing={
          <span className="text-sm" aria-live="polite">
            {availability === 'checking' && (
              <span className="text-muted-foreground">Checking…</span>
            )}
            {availability === 'ok' && <span className={TONE_CLASSES.success.text}>Available</span>}
            {availability === 'taken' && <span className={TONE_CLASSES.danger.text}>Taken</span>}
            {availability === 'invalid' && (
              <span className={TONE_CLASSES.danger.text}>Invalid</span>
            )}
          </span>
        }
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        maxLength={20}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
      />
    </Field>
  );
}
