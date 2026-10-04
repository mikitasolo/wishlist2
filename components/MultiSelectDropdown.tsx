'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { POPOVER_OPTION_ROW, POPOVER_SURFACE } from './popoverStyles';
import {
  multiSelectSummary,
  plainMultiSelectRule,
  type MultiSelectOption,
} from '@/lib/utils/multiSelect';

export type { MultiSelectOption };

interface MultiSelectDropdownProps<V extends string> {
  /** The options, each a checkbox row under the All row (which is drawn here, not one of them). */
  options: MultiSelectOption<V>[];
  /** Currently selected values. */
  selected: V[];
  onChange: (values: V[]) => void;
  /** The All row's label, and the trigger's while everything is selected. */
  allLabel?: string;
  /** A visible label above the trigger ("List:"). */
  label?: string;
  /** The trigger's accessible name, when there's no visible `label`. */
  ariaLabel?: string;
  /** Width and layout classes for the root; the trigger always fills it. */
  className?: string;
  /**
   * A switch under the options that changes which options there are (e.g.
   * "Include archived" on the list filter), rather than being one of them.
   */
  extraToggle?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
}

const CHECKBOX = 'h-4 w-4 flex-shrink-0 cursor-pointer accent-primary-600';

/**
 * A filter that picks any number of options: a trigger saying what's picked,
 * opening a checkbox list with an All row on top: the list filter on Items.
 */
export default function MultiSelectDropdown<V extends string>({
  options,
  selected,
  onChange,
  allLabel = 'All',
  label,
  ariaLabel,
  className = '',
  extraToggle,
}: MultiSelectDropdownProps<V>) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const values = options.map((o) => o.value);
  const rule = plainMultiSelectRule<V>();
  const isAll = rule.isAll(selected, values);
  const toggle = (value: V | null) => onChange(rule.toggle(selected, value, values));

  const row = `${POPOVER_OPTION_ROW} cursor-pointer transition-colors hover:bg-muted`;

  return (
    <div className={`relative ${className}`} ref={ref}>
      {label && (
        <label className="mb-2 block whitespace-nowrap text-xs font-medium text-foreground sm:text-sm">
          {label}:
        </label>
      )}
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setIsOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3.5 text-sm font-medium text-foreground outline-hidden field-focus transition-colors hover:bg-surface-hover"
      >
        <span className="truncate">{multiSelectSummary(selected, options, isAll, allLabel)}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div
          className={`absolute left-0 top-full z-50 mt-2 flex max-h-72 w-max min-w-full max-w-[calc(100vw-2rem)] flex-col sm:max-w-xs ${POPOVER_SURFACE}`}
        >
          <div className="min-h-0 overflow-auto">
            <label className={`${row} text-foreground`}>
              <input
                type="checkbox"
                checked={isAll}
                onChange={() => toggle(null)}
                className={CHECKBOX}
              />
              <span className="truncate">{allLabel}</span>
            </label>
            {options.map((o) => (
              <label key={o.value} className={`${row} text-foreground`}>
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className={CHECKBOX}
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
          {/* Kept in view at the foot of a long, scrolling list. */}
          {extraToggle && (
            <div className="-mx-1.5 mt-1.5 border-t border-border px-1.5 pt-1.5">
              <label className={`${row} text-muted-foreground`}>
                <input
                  type="checkbox"
                  checked={extraToggle.checked}
                  onChange={(e) => extraToggle.onChange(e.target.checked)}
                  className={CHECKBOX}
                />
                <span className="truncate">{extraToggle.label}</span>
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
