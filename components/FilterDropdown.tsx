'use client';

import { useState, useRef, useEffect } from 'react';
import Icon from './Icon';
import {
  isEveryStatusSelected,
  toggleStatusFilter,
  type FilterOption,
} from '@/lib/utils/itemFilters';

export type { FilterOption };

interface FilterDropdownProps {
  options: FilterOption[];
  selectedFilters: FilterOption[];
  /** Never called with an empty selection: unticking the last option, or All, gives `defaultFilters`. */
  onChange: (filters: FilterOption[]) => void;
  /** What the page shows when nothing narrower is picked. */
  defaultFilters: FilterOption[];
  ariaLabel?: string;
  /** Width/layout classes for the root; the trigger always fills it. */
  className?: string;
}

export default function FilterDropdown({
  options,
  selectedFilters,
  onChange,
  defaultFilters,
  ariaLabel,
  className,
}: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const isAllSelected = isEveryStatusSelected(selectedFilters, options);

  const handleToggleFilter = (option: FilterOption) => {
    onChange(toggleStatusFilter(selectedFilters, option, options, defaultFilters));
  };

  const getDisplayLabel = (option: FilterOption): string => {
    const labels: Record<FilterOption, string> = {
      all: 'All',
      draft: 'Draft',
      available: 'Available',
      bookedByMe: 'Booked by Me',
      bookedByOthers: 'Booked by Others',
      completed: 'Completed',
      proposed: 'Proposed',
      proposedByMe: 'Proposed by Me',
    };
    return labels[option];
  };

  // Says what the list shows, so never "None selected": no selection shows everything.
  const displayText = isAllSelected
    ? 'All'
    : selectedFilters.length === 1
      ? getDisplayLabel(selectedFilters[0])
      : `${selectedFilters.length} selected`;

  return (
    <div
      className={`relative ${className ?? 'w-full sm:w-auto sm:min-w-[200px]'}`}
      ref={dropdownRef}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setIsOpen(!isOpen)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3.5 text-sm font-medium text-foreground outline-none field-focus transition-colors hover:bg-surface-hover"
      >
        <span className="truncate">{displayText}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-2 max-h-60 w-full min-w-[220px] overflow-auto rounded-xl border border-border bg-surface py-1.5 shadow-lg">
          {options.map((option) => {
            const isSelected = option === 'all' ? isAllSelected : selectedFilters.includes(option);
            return (
              <label
                key={option}
                className="flex items-center px-4 py-2 hover:bg-muted cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleFilter(option)}
                  className="w-4 h-4 text-accent border-border-strong rounded cursor-pointer"
                />
                <span className="ml-3 text-sm text-foreground">{getDisplayLabel(option)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
