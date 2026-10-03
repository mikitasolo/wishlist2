import Badge, { type BadgeSize } from '@/components/Badge';

/**
 * "2 reserved by you": how many items on a list shared with you that you've
 * reserved yourself, from `reservedByYou` on `GET /api/wishlists`. Nothing when
 * there are none (or the count isn't there, as on a list you own, which never
 * carries one).
 *
 * The green and the gift of the "Reserved by you" status, as a soft tint: it's
 * a count of your reservations, not an item's status. Any surface showing a
 * shared list (its card, a compact row) uses this, so it reads the same.
 */
export default function ReservedByYouChip({
  count,
  size = 'md',
  className = '',
}: {
  count: number | null | undefined;
  size?: BadgeSize;
  /** Position only. */
  className?: string;
}) {
  if (!count || count <= 0) return null;
  return (
    <Badge tone="success" icon="gift" size={size} className={className}>
      {count} reserved by you
    </Badge>
  );
}
