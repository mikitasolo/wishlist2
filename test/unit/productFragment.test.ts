import { describe, it, expect } from 'vitest';
import {
  buildProductFragment,
  FRAGMENT_NAME_MAX,
  FRAGMENT_PRICE_MAX_CENTS,
  FRAGMENT_URL_MAX,
  parseProductFragment,
} from '@/lib/utils/productFragment';

describe('parseProductFragment', () => {
  it('reads every field, price to cents and currency uppercased', () => {
    expect(
      parseProductFragment(
        '#name=Blue%20Mug&price=24.90&currency=eur&image=https%3A%2F%2Fcdn.example.com%2Fm.jpg&link=https%3A%2F%2Fshop.example.com%2Fp%3Fa%3D1%26b%3D2'
      )
    ).toEqual({
      name: 'Blue Mug',
      price: { value: 2490, currency: 'EUR' },
      imageUrl: 'https://cdn.example.com/m.jpg',
      link: 'https://shop.example.com/p?a=1&b=2',
    });
  });

  it('works without the leading #', () => {
    expect(parseProductFragment('name=Mug')).toEqual({ name: 'Mug' });
  });

  it.each([undefined, null, '', '#', '#garbage', '#=&&=', '#%E0%A4%A', '#unknown=1'])(
    'is null for nothing usable: %s',
    (hash) => {
      expect(parseProductFragment(hash)).toBeNull();
    }
  );

  it('drops a link or image that is not http(s)', () => {
    expect(
      parseProductFragment(
        `#name=X&link=${encodeURIComponent('javascript:alert(1)')}&image=${encodeURIComponent('data:image/png;base64,AAAA')}`
      )
    ).toEqual({ name: 'X' });
    expect(parseProductFragment(`#link=${encodeURIComponent('ftp://x.example/a')}`)).toBeNull();
    expect(parseProductFragment('#link=not-a-url')).toBeNull();
  });

  it('drops a URL over the length cap', () => {
    const long = `https://shop.example.com/${'a'.repeat(FRAGMENT_URL_MAX)}`;
    expect(parseProductFragment(`#name=X&link=${encodeURIComponent(long)}`)).toEqual({ name: 'X' });
  });

  it('collapses whitespace in a name and caps its length', () => {
    expect(parseProductFragment('#name=%20%20a%0A%09b%20')).toEqual({ name: 'a b' });
    const out = parseProductFragment(`#name=${'x'.repeat(FRAGMENT_NAME_MAX + 50)}`);
    expect(out?.name).toHaveLength(FRAGMENT_NAME_MAX);
  });

  it('keeps markup in a name as plain text (React escapes it on render)', () => {
    expect(parseProductFragment('#name=%3Cb%3Ehi%3C%2Fb%3E')).toEqual({ name: '<b>hi</b>' });
  });

  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['0.99', 99],
  ])('price %s is %i cents', (price, cents) => {
    expect(parseProductFragment(`#price=${price}&currency=USD`)?.price?.value).toBe(cents);
  });

  it.each(['0', '-5', '1e5', 'abc', '1,50', '12.345', '', '99999999999'])(
    'rejects the price %s',
    (price) => {
      expect(parseProductFragment(`#name=X&price=${price}&currency=USD`)).toEqual({ name: 'X' });
    }
  );

  it('rejects a price above the cap', () => {
    const over = (FRAGMENT_PRICE_MAX_CENTS / 100 + 1).toString();
    expect(parseProductFragment(`#name=X&price=${over}&currency=USD`)).toEqual({ name: 'X' });
  });

  it('needs a three-letter currency with a price (never guessed)', () => {
    expect(parseProductFragment('#name=X&price=10')).toEqual({ name: 'X' });
    expect(parseProductFragment('#name=X&price=10&currency=euro')).toEqual({ name: 'X' });
    expect(parseProductFragment('#name=X&price=10&currency=%24')).toEqual({ name: 'X' });
  });
});

describe('buildProductFragment', () => {
  it('round-trips through the parser, whatever the characters', () => {
    const product = {
      name: 'Tëa & Cøffee "set" #1 — 50% off',
      price: { cents: 12345, currency: 'PLN' },
      imageUrl: 'https://cdn.example.com/a b.jpg?x=1&y=2',
      link: 'https://shop.example.com/p?id=1&ref=a#frag',
    };
    expect(parseProductFragment(buildProductFragment(product))).toEqual({
      name: product.name,
      price: { value: 12345, currency: 'PLN' },
      imageUrl: product.imageUrl,
      link: product.link,
    });
  });

  it('leaves out what was not found', () => {
    expect(buildProductFragment({ link: 'https://shop.example.com/' })).toBe(
      '#link=https%3A%2F%2Fshop.example.com%2F'
    );
  });
});
