import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { addAbortSignal, type Readable } from 'node:stream';
import { Agent, request as undiciRequest, type Dispatcher } from 'undici';

/**
 * The one server-side fetch of a URL a user gave us (WIS-366): an image on a
 * store's page, downloaded so `POST /api/upload/from-url` can re-host it. It's
 * a request our server makes on someone else's say-so (SSRF), so it reaches
 * only the public internet:
 *
 * - `https:` on the default port, with no userinfo (`parseFetchableUrl`);
 * - the host's every resolved address (or its IP literal) must be public
 *   (`isPublicAddress`), compared as bytes, never as text;
 * - the connection is pinned to the address that was checked (`pinnedLookup`
 *   on an undici `Agent`), so DNS answering differently at connect time
 *   (rebinding) can't send it elsewhere; SNI and `Host` stay the URL's name;
 * - redirects are followed by hand, at most `maxRedirects`, each hop checked
 *   again from scratch, as if it were the URL given;
 * - a connect timeout and a total one, covering DNS, every hop and the body;
 * - the body is streamed and dropped past `maxBytes`, whatever
 *   `Content-Length` says; its `Content-Type` isn't read at all (the upload
 *   pipeline sniffs the bytes);
 * - no cookies, credentials or forwarded headers: a neutral UA, an image
 *   `Accept`, and at most the product page's origin as `Referer`.
 *
 * Every failure is a `SafeFetchError` carrying only a coarse `reason`, which is
 * what a log line may say: never the URL, its host or an address (a URL can
 * name a person, and an address tells the network's shape).
 */

export type SafeFetchFailure =
  | 'invalid_url'
  | 'dns'
  | 'blocked_address'
  | 'too_many_redirects'
  | 'bad_status'
  | 'too_large'
  | 'timeout'
  | 'network';

export class SafeFetchError extends Error {
  readonly reason: SafeFetchFailure;
  constructor(reason: SafeFetchFailure) {
    super(`Fetching the URL failed: ${reason}`);
    this.name = 'SafeFetchError';
    this.reason = reason;
  }
}

/** Same as `/api/upload`'s cap: the re-encode pipeline takes nothing bigger. */
export const SAFE_FETCH_MAX_BYTES = 4 * 1024 * 1024;
export const SAFE_FETCH_TIMEOUT_MS = 10_000;
export const SAFE_FETCH_CONNECT_TIMEOUT_MS = 5_000;
export const SAFE_FETCH_MAX_REDIRECTS = 3;
const MAX_URL_LENGTH = 2048;

// ── Addresses ───────────────────────────────────────────────────────────────

type Bytes = number[];

function parseIPv4(text: string): Bytes | null {
  if (isIP(text) !== 4) return null;
  return text.split('.').map(Number);
}

/** The 16 bytes of an IPv6 address (zone id dropped), or null if it isn't one. */
function parseIPv6(text: string): Bytes | null {
  const address = text.split('%')[0];
  if (isIP(address) !== 6) return null;
  let hextets = address;
  // A dotted IPv4 tail (`::ffff:10.0.0.1`) is the last two hextets.
  const tail = address.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const v4 = parseIPv4(tail[2]);
    if (!v4) return null;
    hextets = `${tail[1]}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const [head, rest] = hextets.split('::');
  const groups = (part: string | undefined) => (part ? part.split(':') : []);
  const left = groups(head);
  const right = groups(rest);
  const fill = rest === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  const all = [...left, ...fill, ...right];
  if (all.length !== 8) return null;
  return all.flatMap((group) => {
    const value = parseInt(group, 16);
    return [value >> 8, value & 0xff];
  });
}

function inV4Range(ip: Bytes, base: Bytes, bits: number): boolean {
  for (let i = 0; i < 4; i++) {
    const take = Math.max(0, Math.min(8, bits - i * 8));
    const mask = (0xff << (8 - take)) & 0xff;
    if ((ip[i] & mask) !== (base[i] & mask)) return false;
  }
  return true;
}

// Everything that isn't the public internet (RFC 6890's special-purpose
// registry, minus the globally reachable anycast blocks no image is served from).
const NON_PUBLIC_V4: [Bytes, number][] = [
  [[0, 0, 0, 0], 8], // "this network"
  [[10, 0, 0, 0], 8], // private
  [[100, 64, 0, 0], 10], // CGNAT shared space
  [[127, 0, 0, 0], 8], // loopback
  [[169, 254, 0, 0], 16], // link-local, incl. the cloud metadata 169.254.169.254
  [[172, 16, 0, 0], 12], // private
  [[192, 0, 0, 0], 24], // IETF protocol assignments
  [[192, 0, 2, 0], 24], // documentation
  [[192, 88, 99, 0], 24], // 6to4 relay anycast
  [[192, 168, 0, 0], 16], // private
  [[198, 18, 0, 0], 15], // benchmarking
  [[198, 51, 100, 0], 24], // documentation
  [[203, 0, 113, 0], 24], // documentation
  [[224, 0, 0, 0], 4], // multicast
  [[240, 0, 0, 0], 4], // reserved, incl. broadcast 255.255.255.255
];

function isPublicV4(ip: Bytes): boolean {
  return !NON_PUBLIC_V4.some(([base, bits]) => inV4Range(ip, base, bits));
}

const allZero = (bytes: Bytes) => bytes.every((b) => b === 0);

function isPublicV6(ip: Bytes): boolean {
  const v4Tail = ip.slice(12);
  // IPv4-compatible (::a.b.c.d, which takes in :: and ::1 as 0.0.0.0 and
  // 0.0.0.1), IPv4-mapped (::ffff:a.b.c.d) and IPv4-translated
  // (::ffff:0:a.b.c.d): the connection goes to the IPv4 address inside.
  if (allZero(ip.slice(0, 10))) {
    const marker = (ip[10] << 8) | ip[11];
    if (marker === 0 || marker === 0xffff) return isPublicV4(v4Tail);
  }
  if (allZero(ip.slice(0, 8)) && ip[8] === 0xff && ip[9] === 0xff && allZero(ip.slice(10, 12))) {
    return isPublicV4(v4Tail);
  }
  // NAT64's well-known prefix 64:ff9b::/96 reaches the IPv4 address inside;
  // its local-use 64:ff9b:1::/48 is a network's own.
  if (ip[0] === 0x00 && ip[1] === 0x64 && ip[2] === 0xff && ip[3] === 0x9b) {
    if (allZero(ip.slice(4, 12))) return isPublicV4(v4Tail);
    return false;
  }
  // Only global unicast (2000::/3) is public. This refuses fc00::/7 (unique
  // local), fe80::/10 (link-local), ff00::/8 (multicast), 100::/64 (discard)
  // and everything unassigned.
  if ((ip[0] & 0xe0) !== 0x20) return false;
  // 2001::/23, IETF protocol assignments: Teredo (2001::/32, whose client
  // address is any IPv4 one), benchmarking, ORCHID, …
  if (ip[0] === 0x20 && ip[1] === 0x01 && (ip[2] & 0xfe) === 0) return false;
  // 2001:db8::/32 and 3fff::/20, documentation.
  if (ip[0] === 0x20 && ip[1] === 0x01 && ip[2] === 0x0d && ip[3] === 0xb8) return false;
  if (ip[0] === 0x3f && ip[1] === 0xff && (ip[2] & 0xf0) === 0) return false;
  // 6to4 (2002::/16) tunnels to the IPv4 address in its next 32 bits.
  if (ip[0] === 0x20 && ip[1] === 0x02) return isPublicV4(ip.slice(2, 6));
  return true;
}

/**
 * Is this IP address on the public internet? Anything else (private,
 * loopback, link-local, CGNAT, multicast, reserved, documentation, IPv6
 * outside global unicast, IPv4 embedded in IPv6 that isn't public), and
 * anything that isn't an IP address at all, is `false`.
 */
export function isPublicAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4) return isPublicV4(v4);
  const v6 = parseIPv6(address);
  if (v6) return isPublicV6(v6);
  return false;
}

// ── URLs ────────────────────────────────────────────────────────────────────

/**
 * The URL, if it's one this module may fetch: `https:` on its default port,
 * with no username or password. Throws `invalid_url` otherwise. (The WHATWG
 * parser already turns `https://2130706433/` or `0x7f.1` into `127.0.0.1`;
 * whatever the host, its addresses are what get checked.)
 */
export function parseFetchableUrl(input: unknown): URL {
  if (typeof input !== 'string' || input.length > MAX_URL_LENGTH) {
    throw new SafeFetchError('invalid_url');
  }
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new SafeFetchError('invalid_url');
  }
  // `URL` drops the scheme's default port, so `:443` reads as ''.
  if (url.protocol !== 'https:' || url.port !== '' || url.username || url.password) {
    throw new SafeFetchError('invalid_url');
  }
  if (!url.hostname) throw new SafeFetchError('invalid_url');
  return url;
}

/**
 * The `Referer` to send for a product page's image: the page's origin and no
 * more (no path or query, which can name a person), or nothing when the page
 * isn't an http(s) URL.
 */
export function refererFor(pageUrl: unknown): string | undefined {
  if (typeof pageUrl !== 'string' || pageUrl.length > MAX_URL_LENGTH) return undefined;
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    return `${url.origin}/`;
  } catch {
    return undefined;
  }
}

// ── Resolving and pinning ───────────────────────────────────────────────────

export interface CheckedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new SafeFetchError('timeout'));
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

/**
 * The address to connect to for `hostname`, once every address it resolves to
 * is public (one non-public answer refuses the host: which one a connection
 * would pick isn't ours to choose). An IP literal is checked as it stands.
 */
export async function resolvePublicAddress(
  hostname: string,
  resolve: Resolver,
  signal: AbortSignal
): Promise<CheckedAddress> {
  const literal = hostname.replace(/^\[(.*)\]$/, '$1');
  const literalFamily = isIP(literal);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!isPublicAddress(literal)) throw new SafeFetchError('blocked_address');
    return { address: literal, family: literalFamily };
  }

  let answers: { address: string; family: number }[];
  try {
    answers = await Promise.race([resolve(hostname), whenAborted(signal)]);
  } catch (error) {
    if (error instanceof SafeFetchError) throw error;
    throw new SafeFetchError('dns');
  }
  if (answers.length === 0) throw new SafeFetchError('dns');
  if (answers.some((answer) => !isPublicAddress(answer.address))) {
    throw new SafeFetchError('blocked_address');
  }
  const family = isIP(answers[0].address);
  if (family !== 4 && family !== 6) throw new SafeFetchError('dns');
  return { address: answers[0].address, family };
}

/**
 * A `lookup` for `net.connect` that answers every name with the address that
 * was checked, never asking DNS again.
 */
export function pinnedLookup(pinned: CheckedAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, [{ address: pinned.address, family: pinned.family }]);
    else callback(null, pinned.address, pinned.family);
  };
}

export interface AgentOptions {
  connectTimeoutMs: number;
}

/**
 * A one-request undici `Agent` whose connections all go to `pinned`. The URL
 * keeps its hostname, so TLS still verifies the certificate for that name
 * (SNI) and `Host` is that name.
 */
export function createPinnedAgent(pinned: CheckedAddress, options: AgentOptions): Dispatcher {
  return new Agent({
    connect: { lookup: pinnedLookup(pinned), timeout: options.connectTimeoutMs },
    connections: 1,
    pipelining: 0,
  });
}

// ── Fetching ────────────────────────────────────────────────────────────────

export interface SafeFetchOptions {
  /** The product page the image is from, sent as `Referer` (its origin only). */
  referer?: string;
  maxBytes?: number;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxRedirects?: number;
}

/** Seams for tests: DNS, the pinned dispatcher, and the request itself. */
export interface SafeFetchDeps {
  resolve?: Resolver;
  createAgent?: (pinned: CheckedAddress, options: AgentOptions) => Dispatcher;
  request?: typeof undiciRequest;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

const TIMEOUT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function asFailure(error: unknown, signal: AbortSignal): SafeFetchError {
  if (error instanceof SafeFetchError) return error;
  if (signal.aborted) return new SafeFetchError('timeout');
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && TIMEOUT_CODES.has(code)) return new SafeFetchError('timeout');
  return new SafeFetchError('network');
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readCapped(body: Readable, maxBytes: number, signal: AbortSignal): Promise<Buffer> {
  // The total timeout covers the body too, however the stream was made.
  addAbortSignal(signal, body);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    total += chunk.length;
    if (total > maxBytes) {
      body.destroy();
      throw new SafeFetchError('too_large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Download `input` under every rule at the top of this module, and return its
 * bytes (unchecked: the caller sniffs them). Throws `SafeFetchError`.
 */
export async function fetchPublicBytes(
  input: string,
  options: SafeFetchOptions = {},
  deps: SafeFetchDeps = {}
): Promise<Buffer> {
  const {
    maxBytes = SAFE_FETCH_MAX_BYTES,
    timeoutMs = SAFE_FETCH_TIMEOUT_MS,
    connectTimeoutMs = SAFE_FETCH_CONNECT_TIMEOUT_MS,
    maxRedirects = SAFE_FETCH_MAX_REDIRECTS,
  } = options;
  const resolve = deps.resolve ?? systemResolver;
  const createAgent = deps.createAgent ?? createPinnedAgent;
  const request = deps.request ?? undiciRequest;

  const signal = AbortSignal.timeout(timeoutMs);
  const headers: Record<string, string> = {
    accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1',
    'accept-encoding': 'identity',
    'user-agent': 'Mozilla/5.0 (compatible; WishlistImageFetcher/1.0)',
  };
  const referer = refererFor(options.referer);
  if (referer) headers.referer = referer;

  let url = parseFetchableUrl(input);
  for (let hop = 0; ; hop++) {
    const pinned = await resolvePublicAddress(url.hostname, resolve, signal);
    const agent = createAgent(pinned, { connectTimeoutMs });
    try {
      const response = await request(url, {
        method: 'GET',
        dispatcher: agent,
        headers,
        signal,
      }).catch((error: unknown) => {
        throw asFailure(error, signal);
      });

      if (REDIRECTS.has(response.statusCode)) {
        response.body.destroy();
        const location = headerValue(response.headers.location);
        if (!location) throw new SafeFetchError('bad_status');
        if (hop >= maxRedirects) throw new SafeFetchError('too_many_redirects');
        let next: string;
        try {
          next = new URL(location, url).href;
        } catch {
          throw new SafeFetchError('invalid_url');
        }
        // Checked from scratch, as if the user had given it.
        url = parseFetchableUrl(next);
        continue;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.body.destroy();
        throw new SafeFetchError('bad_status');
      }
      try {
        return await readCapped(response.body, maxBytes, signal);
      } catch (error) {
        throw asFailure(error, signal);
      }
    } finally {
      // Nothing is reused across hops or requests: each hop gets its own pin.
      agent.destroy().catch(() => {});
    }
  }
}
