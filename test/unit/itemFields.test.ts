import { describe, it, expect } from 'vitest';
import { isHttpUrl, normalizeItemLink } from '@/lib/utils/itemFields';
import { createItemSchema, updateItemSchema } from '@/lib/validations';

describe('normalizeItemLink', () => {
  it('adds https:// to a link without a scheme', () => {
    expect(normalizeItemLink('amazon.de/dp/1')).toBe('https://amazon.de/dp/1');
    expect(normalizeItemLink('  www.etsy.com/x  ')).toBe('https://www.etsy.com/x');
    expect(normalizeItemLink('localhost:3000/x')).toBe('https://localhost:3000/x');
    expect(normalizeItemLink('//shop.example/x')).toBe('https://shop.example/x');
  });

  it('keeps http(s) links as they are', () => {
    expect(normalizeItemLink('https://shop.example/x')).toBe('https://shop.example/x');
    expect(normalizeItemLink('http://shop.example/x')).toBe('http://shop.example/x');
    expect(normalizeItemLink('HTTPS://shop.example/x')).toBe('HTTPS://shop.example/x');
  });

  it('leaves a link that names another scheme alone, for isHttpUrl to refuse', () => {
    expect(normalizeItemLink('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(normalizeItemLink('ftp://x.example')).toBe('ftp://x.example');
    expect(normalizeItemLink('mailto:a@b.co')).toBe('mailto:a@b.co');
  });

  it('keeps empty empty', () => {
    expect(normalizeItemLink('   ')).toBe('');
  });
});

describe('isHttpUrl', () => {
  it('accepts only absolute http(s) addresses', () => {
    expect(isHttpUrl('https://a.example/x')).toBe(true);
    expect(isHttpUrl('http://a.example')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,hi')).toBe(false);
    expect(isHttpUrl('ftp://a.example')).toBe(false);
    expect(isHttpUrl('a.example/x')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('item schemas: link', () => {
  it.each([
    ['create', createItemSchema, { name: 'x' }],
    ['update', updateItemSchema, {}],
  ] as const)('%s normalises a scheme-less link and refuses non-http(s)', (_, schema, base) => {
    const parsed = schema.safeParse({ ...base, link: 'amazon.de/dp/1' });
    expect(parsed.success && parsed.data.link).toBe('https://amazon.de/dp/1');
    for (const link of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.example', '']) {
      expect(schema.safeParse({ ...base, link }).success).toBe(false);
    }
  });

  it('leaves the link out when none is sent, and clears it with null on update', () => {
    expect(createItemSchema.safeParse({ name: 'x' }).success).toBe(true);
    expect(updateItemSchema.safeParse({ link: null }).success).toBe(true);
  });
});
