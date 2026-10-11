import { formatApproxPrice, formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import type { totalInCurrency } from '@/lib/utils/reservations';

/**
 * Under a dated group's heading (WIS-394): "1 of 3 given" with a bar, and what's
 * still to give in the viewer's currency. Only what's marked as given counts as
 * done; a reserved gift is still to give, whether or not it's been bought.
 */
export default function OccasionProgress({
  progress,
  leftTotal,
}: {
  progress: { given: number; total: number } | null;
  leftTotal: ReturnType<typeof totalInCurrency>;
}) {
  const locale = useViewerLocale();
  if (!progress) return null;
  const percent = progress.total === 0 ? 0 : Math.round((progress.given / progress.total) * 100);
  return (
    <div className="mb-3 space-y-1.5 px-1" data-testid="occasion-progress">
      <p className="text-meta text-muted-foreground">
        {progress.given} of {progress.total} given
        {leftTotal &&
          ` · ${
            leftTotal.approx
              ? formatApproxPrice(leftTotal.price, locale)
              : formatPrice(leftTotal.price, locale)
          } to give`}
      </p>
      <div
        role="progressbar"
        aria-label="Given"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.given}
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-success-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
