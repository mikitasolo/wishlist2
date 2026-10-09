import { describe, it, expect } from 'vitest';
import { cleanProductName, extractProduct, parseAmount } from '@/lib/utils/productExtract';

const URL_ = 'https://shop.example.com/p/mug?x=1';

const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const page = (head: string, body = '') => `<html><head>${head}</head><body>${body}</body></html>`;

describe('extractProduct', () => {
  it('reads a JSON-LD Product with its offer', () => {
    const html = page(
      ld({
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: 'Blue Mug &amp; Saucer',
        image: ['https://cdn.example.com/mug.jpg'],
        offers: { '@type': 'Offer', price: '24.90', priceCurrency: 'eur' },
      })
    );
    expect(extractProduct(html, URL_)).toEqual({
      name: 'Blue Mug & Saucer',
      price: { cents: 2490, currency: 'EUR' },
      imageUrl: 'https://cdn.example.com/mug.jpg',
      link: URL_,
    });
  });

  it('finds the Product inside @graph, and an offer array', () => {
    const html = page(
      ld({
        '@graph': [
          { '@type': 'WebSite', name: 'Shop' },
          {
            '@type': ['Product'],
            name: 'Lamp',
            image: { '@type': 'ImageObject', url: 'https://cdn.example.com/l.png' },
            offers: [{ '@type': 'Offer', price: 1299, priceCurrency: 'PLN' }],
          },
        ],
      })
    );
    const out = extractProduct(html, URL_);
    expect(out.name).toBe('Lamp');
    expect(out.price).toEqual({ cents: 129900, currency: 'PLN' });
    expect(out.imageUrl).toBe('https://cdn.example.com/l.png');
  });

  it('reads a ProductGroup, taking the price from a variant', () => {
    const html = page(
      ld({
        '@type': 'ProductGroup',
        name: 'T-shirt',
        hasVariant: [{ '@type': 'Product', offers: { price: '19.00', priceCurrency: 'USD' } }],
      })
    );
    expect(extractProduct(html, URL_).price).toEqual({ cents: 1900, currency: 'USD' });
  });

  it('survives broken JSON-LD and falls back to Open Graph', () => {
    const html = page(
      `<script type="application/ld+json">{ not json</script>
       <meta property="og:title" content="Kettle">
       <meta property="og:image" content="https://cdn.example.com/k.jpg">
       <meta property="product:price:amount" content="1 299,00">
       <meta property="product:price:currency" content="RUB">`
    );
    expect(extractProduct(html, URL_)).toEqual({
      name: 'Kettle',
      price: { cents: 129900, currency: 'RUB' },
      imageUrl: 'https://cdn.example.com/k.jpg',
      link: URL_,
    });
  });

  it('reads microdata when there is nothing else', () => {
    const html = page(
      '',
      `<div itemscope itemtype="https://schema.org/Product">
         <h1 itemprop="name">Desk lamp</h1>
         <img itemprop="image" src="/img/lamp.jpg">
         <span itemprop="price" content="45.50">45,50</span>
         <meta itemprop="priceCurrency" content="GBP">
       </div>`
    );
    expect(extractProduct(html, URL_)).toEqual({
      name: 'Desk lamp',
      price: { cents: 4550, currency: 'GBP' },
      imageUrl: 'https://shop.example.com/img/lamp.jpg',
      link: URL_,
    });
  });

  it('falls back to the <title> for a name, and sets nothing else', () => {
    expect(extractProduct(page('<title>  Just a &amp; title </title>'), URL_)).toEqual({
      name: 'Just a & title',
      link: URL_,
    });
  });

  it('gives only the link for a page with nothing', () => {
    expect(extractProduct('<html></html>', URL_)).toEqual({ link: URL_ });
  });

  it('resolves relative and protocol-relative image URLs', () => {
    expect(
      extractProduct(page('<meta property="og:image" content="/a/b.jpg">'), URL_).imageUrl
    ).toBe('https://shop.example.com/a/b.jpg');
    expect(
      extractProduct(page('<meta property="og:image" content="//cdn.example.com/b.jpg">'), URL_)
        .imageUrl
    ).toBe('https://cdn.example.com/b.jpg');
  });

  it('ignores a data: image and a non-http one', () => {
    expect(
      extractProduct(page('<meta property="og:image" content="data:image/png;base64,AAAA">'), URL_)
        .imageUrl
    ).toBeUndefined();
    expect(
      extractProduct(page('<meta property="og:image" content="javascript:alert(1)">'), URL_)
        .imageUrl
    ).toBeUndefined();
  });

  it('leaves a price out when its currency is unknown (never guessed)', () => {
    const html = page(ld({ '@type': 'Product', name: 'X', offers: { price: '10' } }));
    expect(extractProduct(html, URL_)).toEqual({ name: 'X', link: URL_ });
  });

  // regression: one Shopify theme writes the JSON-LD price in minor units
  // ("23000" for 230,00) while its Open Graph price is right; the item got a
  // price a hundred times too high. When they differ by exactly x100, OG wins.
  it('trusts Open Graph when the JSON-LD price is exactly x100 of it', () => {
    const html = page(
      `${ld({
        '@type': 'Product',
        name: 'Boots',
        offers: { price: '23000', priceCurrency: 'PLN' },
      })}
       <meta property="product:price:amount" content="230.00">
       <meta property="product:price:currency" content="PLN">`
    );
    expect(extractProduct(html, URL_).price).toEqual({ cents: 23000, currency: 'PLN' });
  });

  it('keeps the JSON-LD price when OG merely differs', () => {
    const html = page(
      `${ld({ '@type': 'Product', name: 'B', offers: { price: '25.00', priceCurrency: 'PLN' } })}
       <meta property="product:price:amount" content="230.00">
       <meta property="product:price:currency" content="PLN">`
    );
    expect(extractProduct(html, URL_).price).toEqual({ cents: 2500, currency: 'PLN' });
  });
});

describe('cleanProductName', () => {
  // regression: store boilerplate ended up in the item's name.
  it.each([
    ['Philips Kettle : [Amazon.pl](http://Amazon.pl): Dom i kuchnia', 'Philips Kettle'],
    ['Philips Kettle : Amazon.pl: Dom i kuchnia', 'Philips Kettle'],
    ['Amazon.de: Philips Kettle', 'Philips Kettle'],
    ['Save 30% on Hades II on Steam', 'Hades II'],
    ['Чайник Bosch — купить в интернет-магазине', 'Чайник Bosch'],
    ['Plain name', 'Plain name'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanProductName(input)).toBe(expected);
  });

  it('never cleans a name down to nothing', () => {
    expect(cleanProductName('Save 30% on ')).toBe('Save 30% on');
  });

  it('is applied to extracted names', () => {
    const html = page('<meta property="og:title" content="Save 10% on Hades II on Steam">');
    expect(extractProduct(html, URL_).name).toBe('Hades II');
  });
});

describe('parseAmount', () => {
  it.each([
    ['1 299,00', 1299],
    ['1,299.00', 1299],
    ['12,99', 12.99],
    ['1,299', 1299],
    ['1.299.000', 1299000],
    ['$ 24.90', 24.9],
  ])('%s', (raw, n) => {
    expect(parseAmount(raw)).toBe(n);
  });

  it('rejects zero, negatives and non-numbers', () => {
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('free')).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});
