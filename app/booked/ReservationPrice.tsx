import { convertedPrice, formatApproxPrice, formatPrice } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import type { Price } from './types';

/**
 * A reservation's price in the viewer's currency (D9): "≈ €247" with the
 * original small under it, or exactly as it is when it's in their currency
 * already, or can't be converted yet.
 */
export default function ReservationPrice({
  price,
  viewerCurrency,
  rates,
  compact = false,
}: {
  price: Price;
  viewerCurrency: string;
  rates: Record<string, number> | null;
  compact?: boolean;
}) {
  const locale = useViewerLocale();
  const converted = convertedPrice(price, viewerCurrency, rates);
  if (!converted) {
    return (
      <span className="text-sm font-medium text-muted-foreground">
        {formatPrice(price, locale)}
      </span>
    );
  }
  return (
    <span className={compact ? 'inline' : 'flex flex-col'}>
      <span className="text-sm font-medium text-muted-foreground">
        {formatApproxPrice(converted, locale)}
      </span>
      <span className="text-xs text-muted-foreground">
        {compact ? ' · ' : ''}
        {formatPrice(price, locale)}
      </span>
    </span>
  );
}
