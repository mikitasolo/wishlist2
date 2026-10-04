'use client';

import Link from 'next/link';
import Badge from '@/components/Badge';
import IconButton from '@/components/IconButton';
import SnapshotThumb from '@/components/SnapshotThumb';
import { formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';

export interface GiftEntry {
  _id: string;
  itemName: string;
  itemImage: string | null;
  itemPrice: { value: number; currency: string } | null;
  recipientUsername: string | null;
  wishlistName: string | null;
  wishlistId: string | null;
  giftedAt: string;
}

/** Past this many entries, the history is split under a header for each year. */
export const YEAR_HEADER_THRESHOLD = 10;

function GiftRow({
  gift,
  busy,
  onDelete,
}: {
  gift: GiftEntry;
  busy: boolean;
  onDelete: (id: string) => void;
}) {
  const locale = useViewerLocale();
  const date = new Date(gift.giftedAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return (
    <li className="flex items-center gap-3 p-3 sm:px-4">
      <SnapshotThumb src={gift.itemImage} alt={gift.itemName} seed={gift._id} small />
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
        <div className="min-w-0 sm:flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{gift.itemName}</p>
          {/* What isn't known (a recipient, say) is left out, not stood in for. */}
          {(gift.recipientUsername || gift.wishlistName) && (
            <p className="truncate text-xs text-muted-foreground">
              {gift.recipientUsername && (
                <Link
                  href={`/users/${encodeURIComponent(gift.recipientUsername)}`}
                  className="text-accent hover:underline"
                >
                  to @{gift.recipientUsername}
                </Link>
              )}
              {gift.recipientUsername && gift.wishlistName && ' · '}
              {gift.wishlistName}
            </p>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground sm:shrink-0 sm:text-right">
          <time dateTime={gift.giftedAt}>{date}</time>
          {gift.itemPrice && ` · ${formatPrice(gift.itemPrice, locale)}`}
        </p>
      </div>
      <IconButton
        icon="trash"
        label="Delete from gift history"
        title="Delete from gift history"
        variant="danger-ghost"
        disabled={busy}
        onClick={() => onDelete(gift._id)}
      />
    </li>
  );
}

/** The gifter's history, newest first, under year headers once it's long. */
export default function GiftHistory({
  gifts,
  busy,
  onDelete,
}: {
  gifts: GiftEntry[];
  busy: (id: string) => boolean;
  onDelete: (id: string) => void;
}) {
  const byYear = gifts.length > YEAR_HEADER_THRESHOLD;
  const groups: { year: string | null; items: GiftEntry[] }[] = [];
  for (const g of gifts) {
    const year = byYear ? String(new Date(g.giftedAt).getFullYear()) : null;
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.items.push(g);
    else groups.push({ year, items: [g] });
  }
  return (
    <section>
      <h2 className="mb-4 flex items-center gap-2 px-1 text-xl font-semibold tracking-tight text-foreground">
        Gift history
        <Badge size="sm">{gifts.length}</Badge>
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        {groups.map((group) => (
          <div key={group.year ?? 'all'} className="border-border [&:not(:first-child)]:border-t">
            {group.year && (
              <h3 className="bg-muted/50 px-3 py-2 text-xs font-semibold text-muted-foreground sm:px-4">
                {group.year}
              </h3>
            )}
            <ul className="divide-y divide-border">
              {group.items.map((g) => (
                <GiftRow key={g._id} gift={g} busy={busy(g._id)} onDelete={onDelete} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
