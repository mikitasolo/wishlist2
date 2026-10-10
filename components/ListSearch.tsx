'use client';

import { useEffect, useRef, useState } from 'react';
import IconButton from '@/components/IconButton';
import SearchField from '@/components/SearchField';

interface ListSearchProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * The search over a list's items (name and notes, WIS-389). From `sm` up it's
 * the field, always. On a phone it's a search icon that expands into the field
 * (focused) when tapped, and folds back when it loses focus empty; it stays
 * open while it holds text, so a query (a `?q=` link) is always in view.
 */
export default function ListSearch({ value, onChange }: ListSearchProps) {
  const [open, setOpen] = useState(false);
  const inputWrap = useRef<HTMLDivElement>(null);
  const expanded = open || value !== '';

  // Focus the field the icon just opened.
  useEffect(() => {
    if (open) inputWrap.current?.querySelector('input')?.focus();
  }, [open]);

  return (
    <>
      {!expanded && (
        <IconButton
          icon="search"
          label="Open search"
          size="sm"
          variant="secondary"
          onClick={() => setOpen(true)}
          className="sm:hidden"
        />
      )}
      <div
        ref={inputWrap}
        className={`min-w-[6rem] flex-1 ${expanded ? '' : 'hidden sm:block'}`}
        onBlur={(e) => {
          // Folds only when focus leaves the field and the clear button, empty.
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && value === '') {
            setOpen(false);
          }
        }}
      >
        <SearchField
          size="sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClear={() => onChange('')}
          placeholder="Search items"
          aria-label="Search items"
        />
      </div>
    </>
  );
}
