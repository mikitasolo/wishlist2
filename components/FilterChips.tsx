'use client';

import { useRef, type KeyboardEvent } from 'react';

export interface FilterChip<T extends string> {
  value: T;
  label: string;
  /** How many items the chip shows. */
  count: number;
}

interface FilterChipsProps<T extends string> {
  chips: readonly FilterChip<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The row's accessible name. */
  ariaLabel: string;
  className?: string;
}

/**
 * One row of single-select filter chips, each with its count: the status
 * chips over a list's items (D7). On a phone the row scrolls sideways rather
 * than wrap, bleeding to the screen's edges.
 *
 * A WAI-ARIA radio group, as `SegmentedControl` is: each chip is a `radio`
 * with `aria-checked` (a test finds one with `getByRole('radio', { name })`,
 * whose name is its label and count). The row is one Tab stop, on the
 * selected chip; the arrow keys (wrapping), Home and End move to another chip
 * and select it, and a click or Space picks one too.
 */
export default function FilterChips<T extends string>({
  chips,
  value,
  onChange,
  ariaLabel,
  className = '',
}: FilterChipsProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = chips.length;
  const selected = chips.findIndex((c) => c.value === value);
  const tabStop = selected === -1 ? 0 : selected;

  function select(index: number) {
    const chip = chips[index];
    refs.current[index]?.focus();
    if (chip.value !== value) onChange(chip.value);
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    select(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      // Room for the focus outline, which the scroll box would clip.
      className={`scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 ${className}`}
    >
      {chips.map((chip, i) => {
        const checked = i === selected;
        return (
          <button
            key={chip.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`inline-flex h-9 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors ${
              checked
                ? 'border-transparent bg-foreground text-background'
                : 'border-border bg-surface text-foreground hover:bg-surface-hover'
            }`}
          >
            {/* The space keeps the name read as "Available 4", not "Available4". */}
            {chip.label}{' '}
            <span
              className={`tabular-nums ${checked ? 'text-background/70' : 'text-muted-foreground'}`}
            >
              {chip.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
