'use client';

import { useId, useMemo, useState } from 'react';
import Cover from '@/components/Cover';
import SearchField from '@/components/SearchField';
import { coverInitial } from '@/lib/utils/cover';
import { FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';
import { POPOVER_OPTION_ROW } from '@/components/popoverStyles';
import { ITEM_LINKS_MAX, type ItemRef } from '@/lib/utils/itemLinks';

/** Above this many candidates the picker offers a search; a handful needs none. */
export const LINK_SEARCH_MIN = 6;

/** A candidate row: the item, with the image the list page already holds. */
export interface LinkOption extends ItemRef {
  imageUrl?: string | null;
}

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
  options: readonly LinkOption[];
  /** The ids ticked. */
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const labelId = useId();
  const noteId = useId();
  const atCap = selected.length >= ITEM_LINKS_MAX;
  const [query, setQuery] = useState('');
  const searchable = options.length > LINK_SEARCH_MIN;
  const needle = searchable ? query.trim().toLowerCase() : '';

  // Ticked items are pinned first and stay whatever the search says; the
  // search narrows only the unticked ones below them.
  const rows = useMemo(() => {
    const picked = new Set(selected);
    const ticked = options.filter((o) => picked.has(o.id));
    const rest = options.filter(
      (o) => !picked.has(o.id) && (!needle || o.name.toLowerCase().includes(needle))
    );
    return { ticked, rest };
  }, [options, selected, needle]);

  const toggle = (id: string, on: boolean) =>
    onChange(on ? [...selected, id].sort() : selected.filter((s) => s !== id));

  return (
    <div role="group" aria-labelledby={labelId} aria-describedby={noteId}>
      <div className="flex items-baseline justify-between gap-2">
        <span id={labelId} className={FIELD_LABEL}>
          Goes with
        </span>
        <span className="text-sm text-muted-foreground">
          {selected.length} of {ITEM_LINKS_MAX}
        </span>
      </div>
      {searchable && (
        <SearchField
          size="sm"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery('')}
          // Enter in the search must not submit the item form.
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.preventDefault();
          }}
          placeholder="Search items"
          aria-label="Search items to link"
          disabled={disabled}
          className="mb-2"
        />
      )}
      <div className="max-h-56 overflow-y-auto rounded-xl border border-border p-1.5">
        {[...rows.ticked, ...rows.rest].map((option) => {
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
              <Cover
                src={option.imageUrl}
                seed={option.id}
                sizes="32px"
                placeholder={
                  <span className="text-sm font-semibold text-white/90">
                    {coverInitial(option.name)}
                  </span>
                }
                className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-2"
              />
              <span className="truncate">{option.name}</span>
            </label>
          );
        })}
        {rows.ticked.length + rows.rest.length === 0 && (
          <p className="px-2 py-2 text-sm text-muted-foreground">No items match</p>
        )}
      </div>
      <p id={noteId} className={FIELD_HELPER} aria-live="polite">
        {linkPickerNote(selected.length)}
      </p>
    </div>
  );
}
