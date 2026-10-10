'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { IconName } from '@/components/Icon';
import type { BulkItemAction } from '@/lib/utils/bulkItems';
import { plural } from '@/lib/utils/plural';

interface BulkActionBarProps {
  /** How many items are picked. */
  selectedCount: number;
  /** How many picked items each action would change (0 disables it). */
  counts: Record<BulkItemAction, number>;
  /** Whether every pickable item on screen is picked. */
  allSelected: boolean;
  /** Whether there's anything on screen to pick. */
  canSelect: boolean;
  onAction: (action: BulkItemAction) => void;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
}

/**
 * The two changes that ask first, as a single item's do: each frees the item
 * on the list (owners can't see whether anyone reserved it), and Undo can't
 * be honest about that, since the change shows to other people at once.
 * Neither says a reservation goes: the gifter keeps theirs.
 */
const CONFIRM: Record<'draft' | 'received', (n: number) => { title: string; message: string }> = {
  draft: (n) => ({
    title: `Move ${plural(n, 'item')} to draft?`,
    message:
      "Hide them from everyone else? If someone reserved one, it's released here, but they keep it on their Reserved page.",
  }),
  received: (n) => ({
    title: `Mark ${plural(n, 'item')} as received?`,
    message:
      "They stay on the list with a ✓ so people know they're taken care of, and nobody can reserve them. You can mark each one as not received later.",
  }),
};

const CONFIRM_LABEL = { draft: 'Move to draft', received: 'Mark as received' } as const;

/**
 * An owner's Select mode bar on their list (WIS-386): how many are picked,
 * Select all / Clear, Done, and the actions. Sticks to the bottom of the
 * screen (above a phone's tab bar) while the grid runs past it. Each action
 * is enabled only when it would change one of the picked items. Delete asks
 * nothing: it offers Undo (WIS-387).
 */
export default function BulkActionBar({
  selectedCount,
  counts,
  allSelected,
  canSelect,
  onAction,
  onSelectAll,
  onClear,
  onDone,
}: BulkActionBarProps) {
  const [confirm, setConfirm] = useState<'draft' | 'received' | null>(null);
  const mostWanted: BulkItemAction =
    counts.mostWanted === 0 && counts.notMostWanted > 0 ? 'notMostWanted' : 'mostWanted';

  const actions: Array<{
    action: BulkItemAction;
    label: string;
    icon: IconName;
    variant?: 'secondary' | 'danger';
  }> = [
    { action: 'publish', label: 'Publish', icon: 'globe' },
    { action: 'draft', label: 'Move to draft', icon: 'note' },
    { action: 'received', label: 'Mark as received', icon: 'check-circle' },
    {
      action: mostWanted,
      label: mostWanted === 'notMostWanted' ? 'Not most wanted' : 'Mark as most wanted',
      icon: 'star',
    },
    { action: 'delete', label: 'Delete', icon: 'trash', variant: 'danger' },
  ];

  const choose = (action: BulkItemAction) => {
    if (action === 'draft' || action === 'received') setConfirm(action);
    else onAction(action);
  };

  return (
    <div
      role="region"
      aria-label="Selected items"
      className="sticky bottom-[calc(1rem+var(--tab-bar-space,0px))] z-30 mt-6 rounded-2xl border border-border bg-surface p-3 shadow-lg sm:mt-8 sm:px-4"
    >
      <div className="flex items-center gap-2">
        <p
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          aria-live="polite"
        >
          {selectedCount > 0 ? `${selectedCount} selected` : 'Select items'}
        </p>
        {canSelect &&
          (allSelected ? (
            <Button variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={onSelectAll}>
              Select all
            </Button>
          ))}
        <Button variant="secondary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
      {/* One row that scrolls sideways on a phone; wraps from `sm` up. */}
      <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {actions.map(({ action, label, icon, variant = 'secondary' }) => (
          <Button
            key={label}
            variant={variant}
            size="sm"
            icon={icon}
            disabled={counts[action] === 0}
            onClick={() => choose(action)}
            className="flex-shrink-0"
          >
            {label}
          </Button>
        ))}
      </div>

      {confirm && (
        <ConfirmDialog
          isOpen
          title={CONFIRM[confirm](counts[confirm]).title}
          message={CONFIRM[confirm](counts[confirm]).message}
          confirmText={CONFIRM_LABEL[confirm]}
          cancelText="Cancel"
          type={confirm === 'draft' ? 'warning' : 'info'}
          onConfirm={() => {
            const action = confirm;
            setConfirm(null);
            onAction(action);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
