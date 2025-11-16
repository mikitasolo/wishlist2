'use client';

import { useState, useRef, useEffect } from 'react';

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
  label?: string;
}

export default function FilterDropdown({
  options,
  selectedFilters,
  onChange,
  label = 'Filter',
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
    <div className="relative" ref={dropdownRef}>
      <label className="text-xs sm:text-sm font-medium text-gray-700 whitespace-nowrap mb-2 block">
        {label}:
      </label>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full sm:w-auto min-w-[200px] pl-3 pr-8 sm:pr-12 py-2 text-sm sm:text-base border border-gray-300 rounded-lg bg-white text-gray-700 font-medium focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22M6%208l4%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] bg-no-repeat cursor-pointer text-left flex items-center justify-between"
      >
        <span className="truncate">{displayText}</span>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full sm:w-auto min-w-[200px] bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-auto">
          {options.map((option) => {
            const isSelected = option === 'all' ? isAllSelected : selectedFilters.includes(option);
            return (
              <label
                key={option}
                className="flex items-center px-4 py-2 hover:bg-gray-100 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleToggleFilter(option)}
                  className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer"
                />
                <span className="ml-3 text-sm text-gray-700">{getDisplayLabel(option)}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
