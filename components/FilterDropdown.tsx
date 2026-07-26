'use client';

import { useState, useRef, useEffect } from 'react';
import Icon from './Icon';

export type FilterOption =
  | 'all'
  | 'draft'
  | 'available'
  | 'bookedByMe'
  | 'bookedByOthers'
  | 'completed'
  | 'proposed'
  | 'proposedByMe';

interface FilterDropdownProps {
  options: FilterOption[];
  selectedFilters: FilterOption[];
  onChange: (filters: FilterOption[]) => void;
  ariaLabel?: string;
  /** Width/layout classes for the root; the trigger always fills it. */
  className?: string;
}

export default function FilterDropdown({
  options,
  selectedFilters,
  onChange,
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

  const nonAllOptions = options.filter((o) => o !== 'all');
  const isAllSelected =
    selectedFilters.includes('all') ||
    (selectedFilters.length === nonAllOptions.length &&
      nonAllOptions.every((opt) => selectedFilters.includes(opt)));

  const handleToggleFilter = (option: FilterOption) => {
    if (option === 'all') {
      // If "all" is clicked, select all options or deselect all
      if (isAllSelected) {
        onChange([]);
      } else {
        onChange([...options]);
      }
    } else {
      // Toggle individual filter
      const newFilters = selectedFilters.includes(option)
        ? selectedFilters.filter((f) => f !== option && f !== 'all')
        : [...selectedFilters.filter((f) => f !== 'all'), option];

      // If all non-"all" options are selected, also select "all"
      if (nonAllOptions.every((opt) => newFilters.includes(opt))) {
        onChange([...options]);
      } else {
        onChange(newFilters);
      }
    }
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

  const displayText =
    selectedFilters.length === 0
      ? 'None selected'
      : isAllSelected
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
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-surface-hover"
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
