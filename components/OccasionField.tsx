'use client';

import Select from '@/components/Select';
import {
  MAX_OCCASION_YEAR,
  MIN_OCCASION_YEAR,
  OCCASION_KIND_LABELS,
  OCCASION_KINDS,
  type OccasionDraft,
  type OccasionKind,
} from '@/lib/utils/occasion';

// In the picker `other` reads as "Other"; next to the list's name, "Occasion".
const KIND_OPTIONS: { value: OccasionDraft['kind']; label: string }[] = [
  { value: 'none', label: 'None' },
  ...OCCASION_KINDS.map((kind) => ({
    value: kind,
    label: kind === 'other' ? 'Other' : OCCASION_KIND_LABELS[kind],
  })),
];

// What "Repeats every year" starts as when a kind is first picked: a birthday
// or a holiday comes round again, a wedding doesn't.
const YEARLY_BY_DEFAULT: ReadonlySet<OccasionKind> = new Set(['birthday', 'holiday']);

/**
 * The wishlist settings' occasion: a kind (or none), its date, and whether it
 * repeats every year. Controlled: it edits an `OccasionDraft`, which
 * `draftToOccasion` turns into what the API takes. The date is required once a
 * kind is picked, so the form can't be sent without one.
 */
export default function OccasionField({
  value,
  onChange,
  disabled = false,
}: {
  value: OccasionDraft;
  onChange: (next: OccasionDraft) => void;
  disabled?: boolean;
}) {
  const hasOccasion = value.kind !== 'none';

  const pickKind = (picked: string) => {
    const kind = picked as OccasionDraft['kind'];
    if (kind === value.kind) return;
    // Switching between kinds keeps the owner's own choice of yearly; picking
    // one where there was none starts from that kind's default.
    const yearly =
      value.kind === 'none' && kind !== 'none' ? YEARLY_BY_DEFAULT.has(kind) : value.yearly;
    onChange({ ...value, kind, yearly });
  };

  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium text-foreground">
        Occasion <span className="text-muted-foreground">(optional)</span>
      </legend>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
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
            <input
              type="date"
              aria-label="Occasion date"
              required
              min={`${MIN_OCCASION_YEAR}-01-01`}
              max={`${MAX_OCCASION_YEAR}-12-31`}
              value={value.date}
              onChange={(e) => onChange({ ...value, date: e.target.value })}
              className="h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-[15px] outline-none sm:w-48"
              disabled={disabled}
            />
            <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={value.yearly}
                onChange={(e) => onChange({ ...value, yearly: e.target.checked })}
                className="h-4 w-4 cursor-pointer rounded border-border-strong accent-primary-600"
                disabled={disabled}
              />
              Repeats every year
            </label>
          </>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Shown next to the list&apos;s name, with a countdown, to everyone who can see the list. They
        can see its date too.
        {hasOccasion &&
          value.yearly &&
          ' A yearly one counts from any year, so a birthday doesn’t need the year you were born.'}
      </p>
    </fieldset>
  );
}
