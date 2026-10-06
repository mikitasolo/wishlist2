'use client';

import Button from '@/components/Button';
import Select from '@/components/Select';
import { FIELD_ERROR, FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';
import { birthdayFromParts, birthdayParts } from '@/lib/utils/birthday';
import { daysInYearlyMonth } from '@/lib/utils/occasion';

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1).padStart(2, '0'),
  label: new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
    Date.UTC(2000, i, 1)
  ),
}));

const dayOptions = (month: string) =>
  Array.from({ length: daysInYearlyMonth(month) }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label: String(i + 1),
  }));

/**
 * The profile's birthday in Settings: a month and a day, never a year, and
 * Clear. Controlled: it edits the form's `birthday` (`ProfileSettings`), `''`
 * for none, or a half-picked one (`birthdayFromParts`) until both are chosen,
 * which `error` then says.
 */
export default function BirthdayField({
  value,
  onChange,
  disabled,
  error,
}: {
  value: string;
  onChange: (birthday: string) => void;
  disabled?: boolean;
  error?: string | null;
}) {
  const { month, day } = birthdayParts(value);

  function pickMonth(next: string) {
    // Keep the day if the month has it, else its last day (Feb 30 → Feb 29).
    const last = daysInYearlyMonth(next);
    const kept = day && Number(day) > last ? String(last).padStart(2, '0') : day;
    onChange(birthdayFromParts(next, kept));
  }

  return (
    <div role="group" aria-labelledby="birthday-label" aria-describedby="birthday-helper">
      <p id="birthday-label" className={FIELD_LABEL}>
        Birthday
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={month}
          onChange={pickMonth}
          options={MONTH_OPTIONS}
          ariaLabel="Birthday month"
          placeholder="Month"
          size="lg"
          triggerClassName="min-w-0 flex-1 sm:w-40 sm:flex-none"
          disabled={disabled}
        />
        <Select
          value={day}
          onChange={(next) => onChange(birthdayFromParts(month, next))}
          options={dayOptions(month)}
          ariaLabel="Birthday day"
          placeholder="Day"
          size="lg"
          triggerClassName="w-24"
          disabled={disabled}
        />
        {value && (
          <Button variant="ghost" size="lg" onClick={() => onChange('')} disabled={disabled}>
            Clear
          </Button>
        )}
      </div>
      {error ? (
        <p id="birthday-helper" className={FIELD_ERROR}>
          {error}
        </p>
      ) : (
        <p id="birthday-helper" className={`${FIELD_HELPER} mt-1.5`}>
          Just the day and month: no year is kept or shown.
        </p>
      )}
    </div>
  );
}
