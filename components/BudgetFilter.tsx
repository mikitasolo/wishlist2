'use client';

import Input from '@/components/Input';
import { currencySymbol } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';

interface BudgetFilterProps {
  value: string;
  onChange: (value: string) => void;
  /** The viewer's currency: the amount is in it. */
  currency: string;
  /** The text isn't an amount (the filter is off meanwhile). */
  invalid?: boolean;
  className?: string;
}

/**
 * "Under X" over a list's prices, in the viewer's currency (WIS-326). A free
 * amount field for a toolbar; the page keeps the text, so it's never saved.
 */
export default function BudgetFilter({
  value,
  onChange,
  currency,
  invalid,
  className = '',
}: BudgetFilterProps) {
  const locale = useViewerLocale();
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-muted-foreground">Under</span>
      <Input
        size="sm"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        leading={
          <span className="text-sm text-muted-foreground">{currencySymbol(currency, locale)}</span>
        }
        placeholder="Any price"
        aria-label={`Show items under this price, in ${currency}`}
        aria-invalid={invalid || undefined}
        className="min-w-0 flex-1 sm:w-36 sm:flex-none"
      />
    </div>
  );
}
