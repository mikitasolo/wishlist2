import { lookup } from 'node:dns/promises';

// ── SSRF guards ────────────────────────────────────────────────────────────
// When the server fetches a user-supplied URL (paste-a-link import), it must be
// stopped from reaching internal/loopback/link-local/metadata endpoints. These
// helpers validate the URL shape and every resolved IP.

/** Parse an IPv4 string to a 32-bit int, or null if it isn't dotted-quad IPv4. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function ipv4InCidr(ip: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (b & mask);
}

/**
 * Is this IP address private, loopback, link-local, or otherwise not a public
 * destination? Covers the ranges an SSRF attacker would target (incl. the cloud
 * metadata address 169.254.169.254). Handles IPv4, IPv6, and IPv4-mapped IPv6.
 */
export function isPrivateIp(address: string): boolean {
  let ip = address.trim().toLowerCase();
  if (!ip) return true;

  // IPv6
  if (ip.includes(':')) {
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    if (ip === '::1' || ip === '::') return true; // loopback / unspecified
    const hextet = ip.replace(/^\[|\]$/g, '').split(':')[0] || '';
    const first = parseInt(hextet || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (ip.startsWith('2001:db8')) return true; // documentation
    return false;
  }

  // IPv4
  const n = ipv4ToInt(ip);
  if (n === null) return true; // not a parseable IPv4 → treat as unsafe
  return (
    ipv4InCidr(n, '0.0.0.0', 8) ||
    ipv4InCidr(n, '10.0.0.0', 8) ||
    ipv4InCidr(n, '100.64.0.0', 10) ||
    ipv4InCidr(n, '127.0.0.0', 8) ||
    ipv4InCidr(n, '169.254.0.0', 16) ||
    ipv4InCidr(n, '172.16.0.0', 12) ||
    ipv4InCidr(n, '192.0.0.0', 24) ||
    ipv4InCidr(n, '192.0.2.0', 24) ||
    ipv4InCidr(n, '192.168.0.0', 16) ||
    ipv4InCidr(n, '198.18.0.0', 15) ||
    ipv4InCidr(n, '198.51.100.0', 24) ||
    ipv4InCidr(n, '203.0.113.0', 24) ||
    ipv4InCidr(n, '224.0.0.0', 4) || // multicast
    ipv4InCidr(n, '240.0.0.0', 4) // reserved (incl. 255.255.255.255)
  );
}

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal']);

/**
 * Validate the *shape* of a user-supplied URL before any network access:
 * https/http only, no embedded credentials, standard web ports only, and not an
 * obviously-internal hostname or private IP literal. Throws on rejection.
 * DNS-resolved addresses are checked separately (see assertResolvesPublic).
 */
export function assertPublicUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error('Enter a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https links are supported.');
  }
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed.');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw new Error('Only standard web ports are allowed.');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('That host is not allowed.');
  }
  // Reject private IP literals directly in the host.
  if (/^[\d.]+$/.test(host) || host.includes(':')) {
    if (isPrivateIp(host)) throw new Error('That address is not allowed.');
  }
  return url;
}

/**
 * Resolve a hostname and throw unless *every* address is public. Guards against
 * a public-looking hostname that resolves to an internal IP. (A determined
 * attacker could still DNS-rebind between this check and the fetch's own
 * resolution — pinning the connection to the checked IP is a future hardening.)
 */
export async function assertResolvesPublic(hostname: string): Promise<void> {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // A literal IP was already checked by assertPublicUrl; skip DNS.
  if (/^[\d.]+$/.test(host) || host.includes(':')) return;
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error('Could not resolve that host.');
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error('That host resolves to a non-public address.');
  }
}

export interface SafeFetchResult {
  html: string;
  finalUrl: string;
}

/**
 * Fetch an HTML page from a user-supplied URL with SSRF and resource guards:
 * validates the URL and every redirect hop, resolves to public IPs only, caps
 * the body size, requires an HTML content type, and times out.
 */
export async function fetchHtmlSafely(
  input: string,
  { maxBytes = 1_000_000, timeoutMs = 5000, maxRedirects = 3 } = {}
): Promise<SafeFetchResult> {
  let current = assertPublicUrl(input);

  for (let hop = 0; ; hop++) {
    await assertResolvesPublic(current.hostname);

    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'WishlistBot/1.0 (+link-preview)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    // Handle redirects ourselves so each hop is re-validated.
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop >= maxRedirects) throw new Error('Too many redirects.');
      current = assertPublicUrl(new URL(res.headers.get('location')!, current).href);
      continue;
    }

    if (!res.ok) throw new Error('That page could not be fetched.');
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html') && !type.includes('application/xhtml')) {
      throw new Error('That link is not a web page.');
    }

    // Read up to maxBytes, then stop.
    const reader = res.body?.getReader();
    if (!reader) throw new Error('That page had no content.');
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      chunks.push(value);
      if (received > maxBytes) {
        await reader.cancel();
        break;
      }
    }
    const html = Buffer.concat(chunks).subarray(0, maxBytes).toString('utf8');
    return { html, finalUrl: current.href };
  }
}
