'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';

export interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  /** Selectable options (do NOT include a synthetic "all" — it's rendered here). */
  options: MultiSelectOption[];
  /** Currently selected values. */
  selected: string[];
  onChange: (values: string[]) => void;
  label: string;
  /** Label for the select-all row / trigger when everything is selected. */
  allLabel?: string;
  /**
   * A switch under the options that changes which options there are (e.g.
   * "Include archived" on the list filter), rather than being one of them.
   */
  extraToggle?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
}

/**
 * Generic checkbox multi-select with an "All" toggle, styled to match
 * FilterDropdown. Used where the options aren't the fixed status set
 * (e.g. filtering items by which wishlist they belong to).
 */
export default function MultiSelectDropdown({
  options,
  selected,
  onChange,
  label,
  allLabel = 'All',
  extraToggle,
}: MultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allValues = options.map((o) => o.value);
  const isAll = allValues.length > 0 && allValues.every((v) => selected.includes(v));

  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  const toggleAll = () => onChange(isAll ? [] : [...allValues]);

  const displayText =
    selected.length === 0
      ? 'None selected'
      : isAll
        ? allLabel
        : selected.length === 1
          ? (options.find((o) => o.value === selected[0])?.label ?? '1 selected')
          : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <label className="mb-2 block whitespace-nowrap text-xs font-medium text-foreground sm:text-sm">
        {label}:
      </label>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex h-9 w-full min-w-[200px] items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface-hover sm:w-auto"
      >
        <span className="truncate">{displayText}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-2 max-h-60 w-full min-w-[200px] overflow-auto rounded-xl border border-border bg-surface py-1.5 shadow-lg sm:w-auto">
          <label className="flex cursor-pointer items-center px-4 py-2 hover:bg-muted">
            <input
              type="checkbox"
              checked={isAll}
              onChange={toggleAll}
              className="h-4 w-4 cursor-pointer rounded border-border-strong text-accent"
            />
            <span className="ml-3 text-sm font-medium text-foreground">{allLabel}</span>
          </label>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center px-4 py-2 hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="h-4 w-4 cursor-pointer rounded border-border-strong text-accent"
              />
              <span className="ml-3 truncate text-sm text-foreground">{o.label}</span>
            </label>
          ))}
          {/* Kept in view at the foot of a long, scrolling menu. */}
          {extraToggle && (
            <label className="sticky bottom-0 mt-1.5 flex cursor-pointer items-center border-t border-border bg-surface px-4 py-2.5 hover:bg-muted">
              <input
                type="checkbox"
                checked={extraToggle.checked}
                onChange={(e) => extraToggle.onChange(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-border-strong text-accent"
              />
              <span className="ml-3 text-sm text-muted-foreground">{extraToggle.label}</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
