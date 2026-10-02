import { describe, it, expect } from 'vitest';
import { CURRENCY_OPTIONS } from '@/lib/utils/currencies';
import {
  COUNTRY_CURRENCY,
  ZONE_COUNTRY,
  currencyToOffer,
  suggestCurrency,
} from '@/lib/utils/currencySuggestion';

const OFFERED = new Set(CURRENCY_OPTIONS.map((c) => c.code));

describe('suggestCurrency', () => {
  it.each([
    ['Europe/Minsk', 'BYN'],
    ['Europe/Warsaw', 'PLN'],
    ['Europe/Berlin', 'EUR'],
    ['Europe/Moscow', 'RUB'],
    ['Asia/Vladivostok', 'RUB'],
    ['Europe/London', 'GBP'],
    ['Asia/Tokyo', 'JPY'],
    ['America/Toronto', 'CAD'],
    ['Australia/Sydney', 'AUD'],
    ['Europe/Zurich', 'CHF'],
    ['Asia/Shanghai', 'CNY'],
    ['Asia/Kolkata', 'INR'],
    ['Asia/Calcutta', 'INR'], // the name Chrome reports
    ['America/Sao_Paulo', 'BRL'],
    ['America/Mexico_City', 'MXN'],
    ['Asia/Seoul', 'KRW'],
    ['Europe/Stockholm', 'SEK'],
    ['Europe/Oslo', 'NOK'],
    ['Europe/Copenhagen', 'DKK'],
    ['Europe/Istanbul', 'TRY'],
    ['Africa/Johannesburg', 'ZAR'],
    ['Pacific/Auckland', 'NZD'],
    ['Asia/Singapore', 'SGD'],
    ['Asia/Hong_Kong', 'HKD'],
    ['Europe/Sofia', 'EUR'], // Bulgaria has used the euro since 2026
    ['America/New_York', 'USD'],
    // Territories on an offered currency.
    ['America/Marigot', 'EUR'],
    ['America/Miquelon', 'EUR'],
    ['Indian/Reunion', 'EUR'],
    ['Indian/Christmas', 'AUD'],
    ['Pacific/Tarawa', 'AUD'],
    ['Pacific/Rarotonga', 'NZD'],
    ['Atlantic/Faroe', 'DKK'],
    ['America/Nuuk', 'DKK'],
    ['Arctic/Longyearbyen', 'NOK'],
    ['Europe/Vaduz', 'CHF'],
    ['Europe/Jersey', 'GBP'],
  ])('suggests the currency of the time zone %s: %s', (timeZone, currency) => {
    expect(suggestCurrency({ timeZone })).toBe(currency);
  });

  it('goes by the time zone over the language', () => {
    // Russian is common in Belarus and Poland; English everywhere.
    expect(suggestCurrency({ timeZone: 'Europe/Minsk', language: 'ru-RU' })).toBe('BYN');
    expect(suggestCurrency({ timeZone: 'Europe/Warsaw', language: 'ru' })).toBe('PLN');
    expect(suggestCurrency({ timeZone: 'Europe/Berlin', language: 'en-GB' })).toBe('EUR');
  });

  it('falls back to the region of the language when the zone is unknown', () => {
    expect(suggestCurrency({ timeZone: 'UTC', language: 'en-GB' })).toBe('GBP');
    expect(suggestCurrency({ timeZone: 'Etc/GMT-3', language: 'pl-PL' })).toBe('PLN');
    expect(suggestCurrency({ timeZone: 'Mars/Olympus_Mons', language: 'de-AT' })).toBe('EUR');
    expect(suggestCurrency({ timeZone: '', language: 'fr-CA' })).toBe('CAD');
    expect(suggestCurrency({ language: 'zh-Hant-HK' })).toBe('HKD');
    expect(suggestCurrency({ timeZone: null, language: 'de-CH' })).toBe('CHF');
  });

  // A zone that names a place says where someone is; the language only guesses.
  it('suggests nothing from the language for a place whose currency we don’t offer', () => {
    expect(suggestCurrency({ timeZone: 'Europe/Kyiv', language: 'ru-RU' })).toBe('USD');
    expect(suggestCurrency({ timeZone: 'Europe/Kiev', language: 'ru-RU' })).toBe('USD');
    expect(suggestCurrency({ timeZone: 'Asia/Almaty', language: 'ru-RU' })).toBe('USD');
    expect(suggestCurrency({ timeZone: 'Europe/Prague', language: 'en-GB' })).toBe('USD');
    expect(suggestCurrency({ timeZone: 'Europe/Simferopol', language: 'ru-RU' })).toBe('USD');
  });

  // Their country's currency isn't the one in use there.
  it('suggests nothing where another currency is what’s used', () => {
    // A German town that pays in Swiss francs.
    expect(suggestCurrency({ timeZone: 'Europe/Busingen', language: 'de-DE' })).toBe('USD');
    // The north of Cyprus, which pays in lira.
    expect(suggestCurrency({ timeZone: 'Asia/Famagusta', language: 'el-CY' })).toBe('USD');
  });

  it('only counts an explicit region in the language', () => {
    // `ru` alone says nothing about where someone is.
    expect(suggestCurrency({ language: 'ru' })).toBe('USD');
    expect(suggestCurrency({ language: 'pl' })).toBe('USD');
    expect(suggestCurrency({ language: 'es-419' })).toBe('USD');
  });

  it('suggests USD when there is nothing to go on', () => {
    expect(suggestCurrency({})).toBe('USD');
    expect(suggestCurrency({ timeZone: undefined, language: undefined })).toBe('USD');
    expect(suggestCurrency({ timeZone: 'UTC', language: 'en-US' })).toBe('USD');
    expect(suggestCurrency({ timeZone: 'UTC', language: 'not a language tag!' })).toBe('USD');
    // A country whose currency we don't offer.
    expect(suggestCurrency({ timeZone: 'UTC', language: 'uk-UA' })).toBe('USD');
  });

  it('only ever suggests a currency the pickers offer', () => {
    const zones = [...ZONE_COUNTRY.keys(), 'UTC', 'Europe/Kyiv'];
    const languages = [...COUNTRY_CURRENCY.keys()].map((c) => `en-${c}`).concat('en-UA', '');
    for (const timeZone of zones) expect(OFFERED.has(suggestCurrency({ timeZone }))).toBe(true);
    for (const language of languages) {
      expect(OFFERED.has(suggestCurrency({ timeZone: 'UTC', language }))).toBe(true);
    }
  });
});

describe('the time zone and country tables', () => {
  it('map every country to a currency the pickers offer, other than USD', () => {
    for (const [country, currency] of COUNTRY_CURRENCY) {
      expect(OFFERED.has(currency), country).toBe(true);
      expect(currency, country).not.toBe('USD');
    }
    // And every offered currency but USD has at least one country.
    const mapped = new Set(COUNTRY_CURRENCY.values());
    for (const { code } of CURRENCY_OPTIONS) {
      if (code !== 'USD') expect(mapped.has(code), code).toBe(true);
    }
  });

  it('give every zone a country that has a currency', () => {
    for (const [zone, country] of ZONE_COUNTRY) {
      expect(COUNTRY_CURRENCY.has(country), zone).toBe(true);
    }
  });

  // A browser reports a zone by the name its engine knows it by (Chrome:
  // `Asia/Calcutta`; Firefox: `Asia/Kolkata`), so a zone listed under one name
  // must be listed under the engine's name too.
  it('only list real zones, under the name the engine reports them by as well', () => {
    for (const [zone, country] of ZONE_COUNTRY) {
      const reported = new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
      expect(ZONE_COUNTRY.get(reported), `${zone} → ${reported}`).toBe(country);
    }
  });
});

describe('currencyToOffer', () => {
  const fresh = { defaultCurrency: 'USD', currencyChosen: false };

  it('offers a USD user who hasn’t answered the suggestion', () => {
    expect(currencyToOffer(fresh, 'PLN')).toBe('PLN');
    expect(currencyToOffer({ defaultCurrency: 'usd' }, 'EUR')).toBe('EUR');
    // A session without a currency is on the default, USD.
    expect(currencyToOffer({}, 'BYN')).toBe('BYN');
  });

  it('never offers anything once they have answered it', () => {
    expect(currencyToOffer({ ...fresh, currencyChosen: true }, 'PLN')).toBeNull();
  });

  it('never offers anything to someone who already moved off USD', () => {
    expect(currencyToOffer({ ...fresh, defaultCurrency: 'EUR' }, 'PLN')).toBeNull();
    expect(currencyToOffer({ ...fresh, defaultCurrency: 'PLN' }, 'PLN')).toBeNull();
  });

  // A prompt offering the USD they already have would ask nothing.
  it('offers nothing when the suggestion is USD or unknown', () => {
    expect(currencyToOffer(fresh, 'USD')).toBeNull();
    expect(currencyToOffer(fresh, null)).toBeNull();
    expect(currencyToOffer(fresh, 'XYZ')).toBeNull();
  });

  it('offers nothing without a user', () => {
    expect(currencyToOffer(null, 'PLN')).toBeNull();
    expect(currencyToOffer(undefined, 'PLN')).toBeNull();
  });
});
