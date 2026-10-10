'use client';

import { useRef, type KeyboardEvent } from 'react';
import Badge from '@/components/Badge';
import type { ListTab } from '@/lib/hooks/useListTab';

const TABS: { value: ListTab; label: string }[] = [
  { value: 'items', label: 'Items' },
  { value: 'people', label: 'People' },
  { value: 'settings', label: 'Settings' },
];

/** The id of a tab's button, which labels the panel under the bar while it's selected. */
export const listTabId = (idBase: string, tab: ListTab) => `${idBase}-tab-${tab}`;
/** The id of the panel the bar controls. */
export const listTabPanelId = (idBase: string) => `${idBase}-panel`;

/**
 * An owner's tab bar under a list's title (D5): Items · People (n) · Settings.
 * Members and visitors never get one.
 *
 * A WAI-ARIA tab list with manual activation: the selected tab is the one Tab
 * stop, the arrow keys (wrapping), Home and End move focus between the tabs,
 * and Enter or Space (or a click) opens one. Opening one moves the URL
 * (`useListTab`), so it isn't done on every arrow key, which would leave a
 * history entry per tab passed over.
 *
 * `peopleCount` is everyone on the list, owners and members, once the page has
 * read them; until then (or if that read failed) People carries no count.
 */
export default function WishlistTabs({
  value,
  onChange,
  peopleCount,
  idBase,
}: {
  value: ListTab;
  onChange: (tab: ListTab) => void;
  peopleCount: number | null;
  idBase: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const n = TABS.length;

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="List sections"
      className="mb-4 flex gap-6 border-b border-border sm:mb-6"
    >
      {TABS.map((tab, i) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={listTabId(idBase, tab.value)}
            aria-selected={selected}
            aria-controls={selected ? listTabPanelId(idBase) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={`-mb-px inline-flex h-11 items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 text-sm font-semibold transition-colors ${
              selected
                ? 'border-accent text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.value === 'people' && peopleCount !== null && (
              <Badge size="sm">{peopleCount}</Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
