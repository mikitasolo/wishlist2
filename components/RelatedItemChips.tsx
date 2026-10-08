'use client';

import { badgeClassName } from '@/components/Badge';
import type { ItemRef } from '@/lib/utils/itemLinks';
import { plural } from '@/lib/utils/plural';

const CHIP = `${badgeClassName({ size: 'sm' })} max-w-full cursor-pointer transition-colors hover:bg-muted`;

/**
 * "Goes with" (WIS-29): an item's partners, each a chip that goes to it on the
 * list. With `limit` (the card: 2), the rest are a "+N more" chip that opens
 * the item's sheet, which shows them all. Only names: a chip never says
 * whether its item is reserved. Nothing when there are none.
 */
export default function RelatedItemChips({
  items,
  limit,
  onShow,
  onMore,
  className = '',
}: {
  items: readonly ItemRef[];
  limit?: number;
  /** Go to the partner on the page. */
  onShow?: (itemId: string) => void;
  /** Show them all (the sheet), for the "+N more" chip. */
  onMore?: () => void;
  className?: string;
}) {
  if (items.length === 0) return null;
  const shown = limit !== undefined ? items.slice(0, limit) : items;
  const rest = items.length - shown.length;

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-meta text-muted-foreground">Goes with</span>
      {shown.map((item) =>
        onShow ? (
          <button
            key={item.id}
            type="button"
            onClick={() => onShow(item.id)}
            title={item.name}
            aria-label={`Go to ${item.name}`}
            className={CHIP}
          >
            <span className="truncate">{item.name}</span>
          </button>
        ) : (
          <span
            key={item.id}
            title={item.name}
            className={`${badgeClassName({ size: 'sm' })} max-w-full`}
          >
            <span className="truncate">{item.name}</span>
          </span>
        )
      )}
      {rest > 0 && onMore && (
        <button
          type="button"
          onClick={onMore}
          aria-label={`Goes with ${plural(rest, 'more item')}, show all`}
          className={CHIP}
        >
          +{rest} more
        </button>
      )}
    </div>
  );
}
