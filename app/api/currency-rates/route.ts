import { NextResponse } from 'next/server';
import { ensureCurrencyRatesUpToDate } from '@/lib/utils/currencyRates';

// GET /api/currency-rates - current exchange rates (currency code → units per
// USD), so the client can convert prices to any currency the viewer picks.
export async function GET() {
  try {
    const currencyRate = await ensureCurrencyRatesUpToDate();
    const rates = currencyRate?.rates
      ? Object.fromEntries(currencyRate.rates as Map<string, number>)
      : {};
    return NextResponse.json({ success: true, data: { rates } }, { status: 200 });
  } catch (error) {
    console.error('Error fetching currency rates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch currency rates' },
      { status: 500 }
    );
  }
}
