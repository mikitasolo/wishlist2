import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
// Stub the network/SSRF layer; the real parser still runs on the returned HTML.
vi.mock('@/lib/utils/ssrf', () => ({ fetchHtmlSafely: vi.fn() }));

import { auth } from '@/lib/auth';
import { fetchHtmlSafely } from '@/lib/utils/ssrf';
import { POST } from '@/app/api/import/link/route';

const session = vi.mocked(auth);
const fetchHtml = vi.mocked(fetchHtmlSafely);

function post(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/import/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  session.mockReset();
  fetchHtml.mockReset();
  session.mockResolvedValue({ user: { id: 'u1' } } as never);
});

describe('POST /api/import/link', () => {
  it('401s without a session (no fetch-proxy for anonymous callers)', async () => {
    session.mockResolvedValue(null as never);
    const res = await post({ url: 'https://example.com' });
    expect(res.status).toBe(401);
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('400s when no url is provided', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('returns parsed OG metadata for a valid page', async () => {
    fetchHtml.mockResolvedValue({
      finalUrl: 'https://shop.example.com/p/1',
      html: `<meta property="og:title" content="Nice Mug">
             <meta property="og:image" content="https://cdn.example.com/mug.jpg">
             <meta property="og:price:amount" content="12.50">
             <meta property="og:price:currency" content="EUR">`,
    });
    const res = await post({ url: 'https://shop.example.com/p/1' });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data).toMatchObject({
      title: 'Nice Mug',
      imageUrl: 'https://cdn.example.com/mug.jpg',
      price: { value: 1250, currency: 'eur' },
      link: 'https://shop.example.com/p/1',
    });
  });

  // regression: a rejected SSRF/guard check surfaces as a 400 with its message,
  // never a 500 — and the caller never sees internal details.
  it('400s with the guard message when the fetch is blocked', async () => {
    fetchHtml.mockRejectedValue(new Error('That address is not allowed.'));
    const res = await post({ url: 'http://169.254.169.254/' });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('That address is not allowed.');
  });
});
