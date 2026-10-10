'use client';

import { useEffect, useState } from 'react';
import BaseModal from '@/components/BaseModal';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import LoadError from '@/components/LoadError';
import { Skeleton } from '@/components/Skeleton';
import type { MoveTarget } from '@/lib/hooks/useBulkItemActions';
import { MOVE_WARNING } from '@/lib/utils/bulkItems';
import { formatItemCount } from '@/lib/utils/itemCounts';
import { plural } from '@/lib/utils/plural';
import type { ApiResponse } from '@/types/api';

/** The fields of one of the viewer's lists (`GET /api/wishlists` → `owned`) the picker uses. */
interface OwnList {
  _id: string;
  name: string;
  archived?: boolean;
  itemCount?: number;
}

interface MoveItemsDialogProps {
  /** The list the items are on (its id): never offered as a target. */
  wishlistId: string;
  /** How many picked items the move takes. */
  count: number;
  onMove: (target: MoveTarget) => void;
  onClose: () => void;
}

/**
 * Select mode's "Move to list" (WIS-434): pick another of your lists to move
 * the picked items to. It offers the lists you own (co-own included) that
 * aren't archived, apart from this one, as "Save to my list" does, and always
 * shows the same warning (`MOVE_WARNING`), whatever the items are: owners
 * can't see reservations, so it never depends on one. Moving offers Undo, so
 * the pick itself asks nothing more.
 */
export default function MoveItemsDialog({
  wishlistId,
  count,
  onMove,
  onClose,
}: MoveItemsDialogProps) {
  // null while loading; the picker's lists once they're in.
  const [lists, setLists] = useState<OwnList[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  // Bumped by "Try again" to load the lists once more.
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<OwnList | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/wishlists', { cache: 'no-store' });
        const result: ApiResponse<{ owned: OwnList[] }> = await res.json();
        if (cancelled) return;
        if (!result.success || !result.data) {
          setLoadFailed(true);
          return;
        }
        setLists(result.data.owned.filter((w) => !w.archived && w._id !== wishlistId));
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wishlistId, attempt]);

  const retry = () => {
    setLoadFailed(false);
    setLists(null);
    setAttempt((n) => n + 1);
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`Move ${plural(count, 'item')} to another list`}
      titleId="move-items-title"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!picked}
            onClick={() => picked && onMove({ _id: picked._id, name: picked.name })}
          >
            Move
          </Button>
        </>
      }
    >
      <Callout tone="warning" className="mb-4">
        {MOVE_WARNING}
      </Callout>
      {loadFailed ? (
        <LoadError compact level={3} title="Couldn’t load your lists" onRetry={retry} />
      ) : lists === null ? (
        <div className="space-y-2" aria-label="Loading your lists">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          You don&apos;t have another list to move these to.
        </p>
      ) : (
        <>
          <p id="move-items-pick" className="mb-3 text-sm text-muted-foreground">
            Pick one of your lists.
          </p>
          <ul className="space-y-2" aria-labelledby="move-items-pick">
            {lists.map((list) => {
              const isPicked = picked?._id === list._id;
              return (
                <li key={list._id}>
                  <button
                    type="button"
                    aria-pressed={isPicked}
                    onClick={() => setPicked(list)}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors hover:bg-muted ${
                      isPicked ? 'border-accent bg-muted' : 'border-border'
                    }`}
                  >
                    <span className="truncate font-medium text-foreground">{list.name}</span>
                    {typeof list.itemCount === 'number' && (
                      <span className="flex-shrink-0 text-xs text-muted-foreground" aria-hidden>
                        {formatItemCount(list.itemCount)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </BaseModal>
  );
}
