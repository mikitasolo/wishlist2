'use client';

import { useId } from 'react';
import { FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';
import { POPOVER_OPTION_ROW } from '@/components/popoverStyles';
import { ITEM_LINKS_MAX, type ItemRef } from '@/lib/utils/itemLinks';

const CHECKBOX = 'h-4 w-4 flex-shrink-0 accent-primary-600';

/** The note under the picker: what it's for, or that it's full. */
export function linkPickerNote(picked: number): string {
  return picked >= ITEM_LINKS_MAX
    ? `That's ${ITEM_LINKS_MAX}, the most an item can go with`
    : `Everyone who can see it sees these on the item. Up to ${ITEM_LINKS_MAX}.`;
}

/**
 * "Goes with" in an owner's add and edit item dialogs (WIS-29): a checklist of
 * the list's other items, at most `ITEM_LINKS_MAX` ticked. At the cap, the
 * unticked ones are disabled and the note says why; the server holds the cap
 * on both sides, and refuses a partner that's full with its name.
 */
export default function ItemLinkPicker({
  options,
  selected,
  onChange,
  disabled,
}: {
  /** The other items on the list it can go with (never a proposal). */
  options: readonly ItemRef[];
  /** The ids ticked. */
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const noteId = useId();
  const atCap = selected.length >= ITEM_LINKS_MAX;

  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...selected, id].sort() : selected.filter((s) => s !== id));

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={noteId}>
      <span id={labelId} className={FIELD_LABEL}>
        Goes with
      </span>
      <div className="max-h-48 overflow-y-auto rounded-xl border border-border p-1.5">
        {options.map((option) => {
          const checked = selected.includes(option.id);
          const full = !checked && atCap;
          return (
            <label
              key={option.id}
              className={`${POPOVER_OPTION_ROW} text-foreground ${
                full || disabled
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer transition-colors hover:bg-muted'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled || full}
                onChange={(e) => toggle(option.id, e.target.checked)}
                className={CHECKBOX}
              />
              <span className="truncate">{option.name}</span>
            </label>
          );
        })}
      </div>
      <p id={noteId} className={FIELD_HELPER} aria-live="polite">
        {linkPickerNote(selected.length)}
      </p>
    </div>
  );
}
