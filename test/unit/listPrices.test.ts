import { describe, it, expect } from 'vitest';
import {
  defaultPricesChoice,
  needsPricesControl,
  ORIGINAL_PRICES,
  pricesChoiceKey,
  rememberPricesChoice,
  savedPricesChoice,
  viewerPriceCurrency,
} from '@/lib/utils/listPrices';

function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe('viewerPriceCurrency', () => {
  it('uppercases the default, and falls back to USD', () => {
    expect(viewerPriceCurrency('pln')).toBe('PLN');
    expect(viewerPriceCurrency('EUR')).toBe('EUR');
    expect(viewerPriceCurrency(undefined)).toBe('USD');
    expect(viewerPriceCurrency('')).toBe('USD');
  });
});

describe('needsPricesControl', () => {
  it("is false when every price is in the viewer's currency, whatever the case", () => {
    expect(needsPricesControl([{ price: { currency: 'pln' } }], 'PLN')).toBe(false);
    expect(needsPricesControl([{ price: { currency: 'PLN' } }], 'pln')).toBe(false);
  });

  it('is false with no prices at all', () => {
    expect(needsPricesControl([{ price: null }, {}], 'PLN')).toBe(false);
    expect(needsPricesControl([], 'PLN')).toBe(false);
  });

  it('is true when the list mixes currencies, or is all in another one', () => {
    expect(
      needsPricesControl([{ price: { currency: 'pln' } }, { price: { currency: 'eur' } }], 'PLN')
    ).toBe(true);
    expect(needsPricesControl([{ price: { currency: 'eur' } }], 'PLN')).toBe(true);
  });
});

describe('defaultPricesChoice', () => {
  it("starts someone else's list on the viewer's currency", () => {
    expect(defaultPricesChoice('others', 'pln')).toBe('PLN');
  });

  it("starts an owner's own list on each item's currency", () => {
    expect(defaultPricesChoice('own', 'PLN')).toBe(ORIGINAL_PRICES);
  });
});

describe('remembering a pick', () => {
  it('keeps a pick per account and per context', () => {
    const storage = memoryStorage();
    rememberPricesChoice(storage, 'u1', 'others', ORIGINAL_PRICES, 'PLN');
    rememberPricesChoice(storage, 'u1', 'own', 'GBP', 'PLN');
    expect(savedPricesChoice(storage, 'u1', 'others')).toBe(ORIGINAL_PRICES);
    expect(savedPricesChoice(storage, 'u1', 'own')).toBe('GBP');
    expect(savedPricesChoice(storage, 'u2', 'others')).toBeNull();
    expect(storage.map.get(pricesChoiceKey('u1', 'own'))).toBe('GBP');
  });

  it("forgets the pick when it's the context's default, so a new default is followed", () => {
    const storage = memoryStorage({ [pricesChoiceKey('u1', 'others')]: 'GBP' });
    rememberPricesChoice(storage, 'u1', 'others', 'PLN', 'pln');
    expect(savedPricesChoice(storage, 'u1', 'others')).toBeNull();

    storage.setItem(pricesChoiceKey('u1', 'own'), 'GBP');
    rememberPricesChoice(storage, 'u1', 'own', ORIGINAL_PRICES, 'PLN');
    expect(savedPricesChoice(storage, 'u1', 'own')).toBeNull();
  });

  it('ignores a stored value Prices no longer offers', () => {
    const storage = memoryStorage({
      [pricesChoiceKey('u1', 'others')]: 'XYZ',
      [pricesChoiceKey('u1', 'own')]: 'gbp',
    });
    expect(savedPricesChoice(storage, 'u1', 'others')).toBeNull();
    expect(savedPricesChoice(storage, 'u1', 'own')).toBeNull();
  });
});
