'use client';

import Select from '@/components/Select';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import {
  daysInYearlyMonth,
  localDateString,
  MAX_OCCASION_YEAR,
  OCCASION_KIND_LABELS,
  OCCASION_KINDS,
  setDraftMonth,
  setDraftYearly,
  type Occasion,
  type OccasionDraft,
  type OccasionKind,
} from '@/lib/utils/occasion';
import { inputClassName } from './fieldStyles';

// In the picker `other` reads as "Other"; next to the list's name, "Occasion".
const KIND_OPTIONS: { value: OccasionDraft['kind']; label: string }[] = [
  { value: 'none', label: 'None' },
  ...OCCASION_KINDS.map((kind) => ({
    value: kind,
    label: kind === 'other' ? 'Other' : OCCASION_KIND_LABELS[kind],
  })),
];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTH_OPTIONS = MONTHS.map((label, i) => ({ value: String(i + 1).padStart(2, '0'), label }));

const dayOptions = (month: string) =>
  Array.from({ length: daysInYearlyMonth(month) }, (_, i) => ({
    value: String(i + 1).padStart(2, '0'),
    label: String(i + 1),
  }));

// What "Repeats every year" starts as when a kind is first picked: a birthday
// or a holiday comes round again, a wedding doesn't.
const YEARLY_BY_DEFAULT: ReadonlySet<OccasionKind> = new Set(['birthday', 'holiday']);

/**
 * The wishlist settings' occasion: a kind (or none), whether it repeats every
 * year, and when. A yearly one is picked as a month and a day, with no year (it
 * has none: only the day and month are stored); a one-off as a full date, from
 * today on. Switching between the two keeps the day and month.
 *
 * Controlled: it edits an `OccasionDraft`, which `draftToOccasion` turns into
 * what the API takes. `saved` is the list's occasion as stored, so a one-off
 * whose date has passed since can still be saved unchanged with the rest of
 * the settings, though a new date has to be today or later.
 */
export default function OccasionField({
  value,
  onChange,
  saved = null,
  disabled = false,
}: {
  value: OccasionDraft;
  onChange: (next: OccasionDraft) => void;
  saved?: Occasion | null;
  disabled?: boolean;
}) {
  const today = useLocalToday();
  const hasOccasion = value.kind !== 'none';
  const keepsSavedDate = saved?.recurrence === null && value.date === saved.date;

  const pickKind = (picked: string) => {
    const kind = picked as OccasionDraft['kind'];
    if (kind === value.kind) return;
    // Switching between kinds keeps the owner's own choice of yearly; picking
    // one where there was none starts from that kind's default.
    const yearly =
      value.kind === 'none' && kind !== 'none' ? YEARLY_BY_DEFAULT.has(kind) : value.yearly;
    onChange(setDraftYearly({ ...value, kind }, yearly, today ?? localDateString()));
  };

  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-foreground">
        Occasion <span className="text-muted-foreground">(optional)</span>
      </legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Select
          value={value.kind}
          onChange={pickKind}
          options={KIND_OPTIONS}
          ariaLabel="Occasion"
          size="md"
          triggerClassName="w-full sm:w-44"
          disabled={disabled}
        />
        {hasOccasion && (
          <>
            {value.yearly ? (
              <div className="flex gap-3">
                <Select
                  value={value.month}
                  onChange={(month) => onChange(setDraftMonth(value, month))}
                  options={MONTH_OPTIONS}
                  ariaLabel="Occasion month"
                  placeholder="Month"
                  size="md"
                  triggerClassName="min-w-0 flex-1 sm:w-40 sm:flex-none"
                  disabled={disabled}
                />
                <Select
                  value={value.day}
                  onChange={(day) => onChange({ ...value, day })}
                  options={dayOptions(value.month)}
                  ariaLabel="Occasion day"
                  placeholder="Day"
                  size="md"
                  triggerClassName="w-24"
                  disabled={disabled}
                />
              </div>
            ) : (
              <input
                type="date"
                aria-label="Occasion date"
                required
                // A new one-off is today or later; one already saved stays as it is.
                min={keepsSavedDate ? undefined : (today ?? undefined)}
                max={`${MAX_OCCASION_YEAR}-12-31`}
                value={value.date}
                onChange={(e) => onChange({ ...value, date: e.target.value })}
                className={`${inputClassName()} sm:w-48`}
                disabled={disabled}
              />
            )}
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={value.yearly}
                onChange={(e) =>
                  onChange(setDraftYearly(value, e.target.checked, today ?? localDateString()))
                }
                className="h-4 w-4 cursor-pointer rounded border-border-strong accent-primary-600"
                disabled={disabled}
              />
              Repeats every year
            </label>
          </>
        )}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        Shown next to the list&apos;s name, with a countdown, to everyone who can see the list.
      </p>
    </fieldset>
  );
}
