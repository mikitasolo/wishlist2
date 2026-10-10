import { formatApproxPrice, formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import type { totalInCurrency } from '@/lib/utils/reservations';

/**
 * The line under the title: "4 to give (≈ €520) · 3 to review", what's left to
 * do at a glance, or the page's introduction while there's nothing to sum up.
 */
export default function ReservedSummary({
  hasReservations,
  toGiveCount,
  toReviewCount,
  toGiveTotal,
}: {
  /** Both lists have loaded and at least one reservation is on the page. */
  hasReservations: boolean;
  toGiveCount: number;
  toReviewCount: number;
  toGiveTotal: ReturnType<typeof totalInCurrency>;
}) {
  const locale = useViewerLocale();
  if (!hasReservations) {
    return (
      <p className="mt-1 text-muted-foreground">
        Gifts you’ve reserved across everyone’s wishlists. When you’ve given one, mark it as given
        to keep it in your gift history.
      </p>
    );
  }
  return (
    <p className="mt-1 text-muted-foreground" data-testid="reserved-summary">
      {[
        `${toGiveCount} to give${
          toGiveTotal
            ? ` (${
                toGiveTotal.approx
                  ? formatApproxPrice(toGiveTotal.price, locale)
                  : formatPrice(toGiveTotal.price, locale)
              })`
            : ''
        }`,
        toReviewCount > 0 && `${toReviewCount} to review`,
      ]
        .filter(Boolean)
        .join(' · ')}
    </p>
  );
}
