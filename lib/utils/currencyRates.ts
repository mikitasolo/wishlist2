import connectDB from '@/lib/mongodb';
import CurrencyRate, { ICurrencyRate } from '@/models/CurrencyRate';

/**
 * Fetches currency exchange rates from the external API
 * Uses USD as base currency
 */
async function fetchCurrencyRatesFromAPI(): Promise<Record<string, number>> {
  const apiUrl =
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json';
  const fallbackUrl = 'https://latest.currency-api.pages.dev/v1/currencies/usd.json';

  try {
    const response = await fetch(apiUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    const data = await response.json();
    return data.usd || {};
  } catch (error) {
    console.error('Error fetching from primary API, trying fallback:', error);
    // Try fallback URL
    try {
      const response = await fetch(fallbackUrl, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`Fallback API returned ${response.status}`);
      }
      const data = await response.json();
      return data.usd || {};
    } catch (fallbackError) {
      console.error('Error fetching from fallback API:', fallbackError);
      throw new Error('Failed to fetch currency rates from both APIs');
    }
  }
}

/**
 * Gets today's date in YYYY-MM-DD format
 */
function getTodayDateString(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Ensures currency rates are up to date for today
 * Fetches new rates if the stored rates are not for today
 */
export async function ensureCurrencyRatesUpToDate(): Promise<ICurrencyRate | null> {
  await connectDB();

  const today = getTodayDateString();

  // Check if we have rates for today
  let currencyRate = await CurrencyRate.findOne({ date: today });

  if (!currencyRate) {
    // Fetch new rates from API
    console.log('Fetching new currency rates for', today);
    const rates = await fetchCurrencyRatesFromAPI();

    // Convert rates object to Map with lowercase keys and ensure USD is included
    const ratesMap = new Map<string, number>();
    for (const [currency, rate] of Object.entries(rates)) {
      ratesMap.set(currency.toLowerCase(), rate as number);
    }

    // Add USD rate (1.0) if not present
    if (!ratesMap.has('usd')) {
      ratesMap.set('usd', 1.0);
    }

    // Save to database
    currencyRate = await CurrencyRate.findOneAndUpdate(
      { date: today },
      {
        date: today,
        rates: ratesMap,
      },
      { upsert: true, new: true }
    );
  }

  return currencyRate;
}

/**
 * Converts a price from any currency to USD cents
 * @param value - Price value in cents (integer) in the source currency
 * @param currency - Source currency code (lowercase, e.g., 'eur', 'usd')
 * @param rates - Currency rates map from CurrencyRate model
 * @returns Price in USD cents (integer), or null if conversion fails
 */
export function convertToUsdCents(
  value: number,
  currency: string,
  rates: Map<string, number>
): number | null {
  if (value == null || !currency || !rates) {
    return null;
  }

  const currencyLower = currency.toLowerCase();

  // If already USD, value is already in cents
  if (currencyLower === 'usd') {
    return Math.round(value);
  }

  // Get exchange rate
  const rate = rates.get(currencyLower);
  if (!rate) {
    console.warn(`Exchange rate not found for currency: ${currency}`);
    return null;
  }

  const dollarsInUsd = value / rate;
  return Math.round(dollarsInUsd);
}

/**
 * Gets currency rate for a specific currency
 * @param currency - Currency code (lowercase)
 * @param rates - Currency rates map from CurrencyRate model
 * @returns Exchange rate, or 1.0 for USD, or null if not found
 */
export function getCurrencyRate(currency: string, rates: Map<string, number>): number | null {
  if (!currency || !rates) {
    return null;
  }

  const currencyLower = currency.toLowerCase();
  if (currencyLower === 'usd') {
    return 1.0;
  }

  return rates.get(currencyLower) || null;
}
