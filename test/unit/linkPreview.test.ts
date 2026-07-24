import { describe, it, expect } from 'vitest';
import { parseLinkMetadata } from '@/lib/utils/linkPreview';

const BASE = 'https://shop.example.com/products/kettle';

describe('parseLinkMetadata', () => {
  it('extracts OG title, image, description, and price (as cents)', () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Copper Kettle" />
        <meta property="og:image" content="https://cdn.example.com/kettle.jpg" />
        <meta property="og:description" content="A shiny kettle" />
        <meta property="og:price:amount" content="49.99" />
        <meta property="og:price:currency" content="USD" />
      </head><body></body></html>`;
    expect(parseLinkMetadata(html, BASE)).toEqual({
      title: 'Copper Kettle',
      imageUrl: 'https://cdn.example.com/kettle.jpg',
      description: 'A shiny kettle',
      price: { value: 4999, currency: 'usd' },
    });
  });

  it('handles reversed attribute order and decodes entities', () => {
    const html = `<meta content="Tom &amp; Jerry&#39;s" property="og:title">`;
    expect(parseLinkMetadata(html, BASE).title).toBe("Tom & Jerry's");
  });

  it('falls back to <title> and resolves a relative image URL', () => {
    const html = `<head><title>  Fallback   Title </title>
      <meta property="og:image" content="/img/p.png"></head>`;
    const meta = parseLinkMetadata(html, BASE);
    expect(meta.title).toBe('Fallback Title');
    expect(meta.imageUrl).toBe('https://shop.example.com/img/p.png');
  });

  it('ignores price when currency is missing or invalid, and non-http images', () => {
    const noCurrency = parseLinkMetadata(`<meta property="og:price:amount" content="10.00">`, BASE);
    expect(noCurrency.price).toBeNull();

    const badImg = parseLinkMetadata(
      `<meta property="og:image" content="data:image/png;base64,xx">`,
      BASE
    );
    expect(badImg.imageUrl).toBeNull();
  });

  it('returns all-null for markup with no usable metadata', () => {
    expect(parseLinkMetadata('<html><body>nothing</body></html>', BASE)).toEqual({
      title: null,
      imageUrl: null,
      description: null,
      price: null,
    });
  });
});
