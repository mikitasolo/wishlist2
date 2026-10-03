'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A leading icon (14px), hidden on the narrowest phones so the label fits. */
  icon?: IconName;
}

/** sm: 32px segments (a compact setting); md: 36px (a form's choice, the default). */
export type SegmentedSize = 'sm' | 'md';

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name: `ariaLabel`, or the id of a visible label. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Ids of whatever describes the choice (a helper line under its label). */
  ariaDescribedBy?: string;
  size?: SegmentedSize;
  disabled?: boolean;
  /** Classes for the track, e.g. a `max-w-*` (it fills its container by default). */
  className?: string;
}

const SEGMENT_HEIGHT: Record<SegmentedSize, string> = { sm: 'h-8', md: 'h-9' };

/**
 * One choice out of a few, shown side by side in a track with a sliding thumb:
 * a list's visibility, a privacy setting, an item's status, the followers
 * dialog's two lists.
 *
 * A WAI-ARIA radio group: the track is a `radiogroup` and each segment a
 * `radio` with `aria-checked` (a test finds one with
 * `getByRole('radio', { name })`). The group is one Tab stop, on the selected
 * segment. The arrow keys (wrapping), Home and End move to another segment and
 * select it, as a native radio group does; a click or Space picks one too.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  size = 'md',
  disabled = false,
  className = '',
}: SegmentedControlProps<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = options.length;
  const selected = options.findIndex((o) => o.value === value);
  // The one Tab stop: the selected segment, or the first while none is.
  const tabStop = selected === -1 ? 0 : selected;

  function select(index: number) {
    const option = options[index];
    refs.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
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
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      aria-disabled={disabled || undefined}
      className={`relative flex w-full rounded-xl border border-border bg-surface-2 p-1 ${className}`}
    >
      {/* The sliding thumb under the selected segment. */}
      {selected !== -1 && (
        <span
          aria-hidden
          className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
          style={{
            width: `calc((100% - 0.5rem) / ${n})`,
            left: `calc(${selected} * ((100% - 0.5rem) / ${n}) + 0.25rem)`,
          }}
        />
      )}
      {options.map((o, i) => {
        const checked = i === selected;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // None while disabled: a disabled button can't take focus, and a
            // `tabindex` would still count it as a stop to a focus trap.
            tabIndex={disabled ? undefined : i === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => select(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${SEGMENT_HEIGHT[size]} ${
              checked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.icon && (
              <Icon name={o.icon} size={14} className="flex-shrink-0 max-[359px]:hidden" />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
