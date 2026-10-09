/**
 * Pull a product's name, image and price out of a page's HTML (WIS-365, from
 * the WIS-33 spike). Sources, in order of trust: JSON-LD (schema.org Product /
 * ProductGroup / Offer, incl. @graph and arrays), Open Graph + product:price:*,
 * microdata itemprop, and finally <title> for the name.
 *
 * Pure and dependency-free apart from `normalizeCurrency` (itself import-free):
 * it runs in a browser on `document.documentElement.outerHTML` and is bundled
 * into the bookmarklet (WIS-367), so it must stay browser-safe: no Node APIs,
 * no DOM either (it works on the HTML string), and no new imports.
 *
 * It only reads the page it is given. Nothing here fetches anything.
 */
import { normalizeCurrency } from '@/lib/utils/currency';

/** What was found: only the fields the page carried. `link` is always the page's address. */
export interface ProductData {
  name?: string;
  price?: { cents: number; currency: string };
  imageUrl?: string;
  link: string;
}

/** A price as read, in major units, before it becomes cents. */
interface RawPrice {
  amount: number;
  currency: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  laquo: '«',
  raquo: '»',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** Decode HTML entities and collapse whitespace. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  if (!m) return null;
  return m[1] ?? m[2] ?? m[3] ?? null;
}

/** An absolute http(s) URL, or null: relative and protocol-relative ones resolve against `base`, `data:` is dropped. */
function absUrl(raw: string | null | undefined, base: string): string | null {
  if (!raw) return null;
  const s = decodeEntities(String(raw));
  if (!s || s.startsWith('data:')) return null;
  try {
    const u = new URL(s.startsWith('//') ? `https:${s}` : s, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

// -- names ------------------------------------------------------------------

/**
 * Store boilerplate around a product name, removed from it. Data-driven: add a
 * rule here (with a test) rather than code. A rule is only applied when
 * something is left of the name.
 */
export const NAME_CLEANUPS: readonly RegExp[] = [
  // Amazon: "Name : [Amazon.pl](http://Amazon.pl): Category" and "Amazon.de: Name"
  /\s*:\s*\[?Amazon\.[a-z.]+(?:\]\([^)]*\))?\s*:.*$/i,
  /^Amazon\.[a-z.]+\s*:\s*/i,
  // Steam: "Save 30% on Name on Steam"
  /^Save \d+% on /i,
  /\s+on Steam$/i,
  // Yandex Market and the like: "Name — купить в интернет-магазине ..."
  /\s+[—–-]\s*купить(?=\s|$).*$/i,
];

export function cleanProductName(name: string): string {
  let out = name.trim();
  for (const rule of NAME_CLEANUPS) {
    const next = out.replace(rule, '').trim();
    if (next) out = next;
  }
  return out;
}

// -- prices -----------------------------------------------------------------

const SYMBOLS: [RegExp, string][] = [
  [/₽|руб|rub|р\./i, 'RUB'],
  [/zł|pln/i, 'PLN'],
  [/byn/i, 'BYN'],
  [/€|eur/i, 'EUR'],
  [/£|gbp/i, 'GBP'],
  [/₴|грн|uah/i, 'UAH'],
  [/₸|kzt/i, 'KZT'],
  [/us\$|usd|(?<![a-z])\$/i, 'USD'],
];

/** A currency code from an ISO code or a symbol; null when it isn't recognised (never guessed). */
function currencyCode(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (/^[a-z]{3}$/i.test(s)) return normalizeCurrency(s);
  for (const [re, code] of SYMBOLS) if (re.test(s)) return code;
  return null;
}

/** "1 299,00" / "1,299.00" / "1299" / 1299.5 → number of major units. */
export function parseAmount(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  if (raw == null) return null;
  let s = String(raw)
    .replace(/[\s  ']/g, '')
    .replace(/[^\d.,]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const thou = dec === '.' ? ',' : '.';
    s = s.split(thou).join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    // "1,299" (thousands) vs "12,99" (decimal): one or two trailing digits → decimal.
    s =
      /,\d{1,2}$/.test(s) && s.split(',').length === 2
        ? s.replace(',', '.')
        : s.split(',').join('');
  } else if ((s.match(/\./g) || []).length > 1 || /^\d{1,3}\.\d{3}$/.test(s)) {
    // "1.299": a European thousands separator, not three decimals.
    s = s.split('.').join('');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// -- JSON-LD ----------------------------------------------------------------

type Json = Record<string, unknown>;

function parseJsonLd(text: string): unknown {
  const t = text
    .trim()
    .replace(/^<!--/, '')
    .replace(/-->$/, '')
    .replace(/^\/\/<!\[CDATA\[/, '')
    .replace(/\/\/\]\]>$/, '')
    .trim();
  try {
    return JSON.parse(t);
  } catch {
    try {
      // Raw control characters inside strings are the commonest breakage.
      return JSON.parse(t.replace(/[\u0000-\u001f]+/g, ' '));
    } catch {
      return undefined;
    }
  }
}

function typesOf(node: Json): string[] {
  const t = node['@type'];
  const list = Array.isArray(t) ? t : t ? [t] : [];
  return list.map((x) => String(x).replace(/^.*[/:#]/, ''));
}

// schema.org types (not app copy) that carry a product's name, image and offer.
const PRODUCT_TYPE = /^(?:Product|ProductGroup|IndividualProduct|ProductModel|Book|Car|Vehicle)$/;

function collectNodes(root: unknown, out: Json[], depth = 0) {
  if (depth > 8 || root == null) return;
  if (Array.isArray(root)) {
    for (const x of root) collectNodes(x, out, depth + 1);
    return;
  }
  if (typeof root !== 'object') return;
  const node = root as Json;
  if (typesOf(node).some((t) => PRODUCT_TYPE.test(t))) out.push(node);
  for (const [k, v] of Object.entries(node)) {
    if (k === 'offers' || k === 'review' || k === 'aggregateRating') continue;
    if (v && typeof v === 'object') collectNodes(v, out, depth + 1);
  }
}

function str(v: unknown): string | null {
  if (typeof v === 'string') return decodeEntities(v) || null;
  if (Array.isArray(v)) return str(v[0]);
  if (v && typeof v === 'object') {
    const o = v as Json;
    return str(o['@value'] ?? o.name ?? null);
  }
  return null;
}

function imageOf(v: unknown, base: string): string | null {
  if (!v) return null;
  if (typeof v === 'string') return absUrl(v, base);
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = imageOf(x, base);
      if (u) return u;
    }
    return null;
  }
  if (typeof v === 'object') {
    const o = v as Json;
    return imageOf(o.contentUrl ?? o.url ?? o.thumbnailUrl ?? null, base);
  }
  return null;
}

function priceOfOffer(o: unknown): RawPrice | null {
  if (!o || typeof o !== 'object') return null;
  if (Array.isArray(o)) {
    for (const x of o) {
      const p = priceOfOffer(x);
      if (p) return p;
    }
    return null;
  }
  const offer = o as Json;
  const cur = currencyCode(offer.priceCurrency);
  for (const key of ['price', 'lowPrice', 'highPrice']) {
    const amount = parseAmount(offer[key]);
    if (amount != null) return { amount, currency: cur };
  }
  const spec = offer.priceSpecification;
  if (spec) {
    const specs = Array.isArray(spec) ? spec : [spec];
    for (const s of specs) {
      const p = priceOfOffer(s);
      if (p) return { ...p, currency: p.currency ?? cur };
    }
  }
  if (offer.offers) return priceOfOffer(offer.offers);
  return null;
}

function priceOfProduct(node: Json): RawPrice | null {
  const direct = priceOfOffer(node.offers);
  if (direct) return direct;
  const variants = node.hasVariant;
  if (Array.isArray(variants)) {
    for (const v of variants) {
      if (v && typeof v === 'object') {
        const p = priceOfOffer((v as Json).offers);
        if (p) return p;
      }
    }
  }
  return null;
}

// -- meta / microdata -------------------------------------------------------

function metaMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop');
    const content = attr(tag, 'content');
    if (key && content != null && content.trim() && !map.has(key.toLowerCase())) {
      map.set(key.toLowerCase(), decodeEntities(content));
    }
  }
  return map;
}

/** First value of an itemprop: its content/src/href attribute, else its text. */
function itemprop(html: string, prop: string, base: string, kind: 'text' | 'url'): string | null {
  const re = new RegExp(`<([a-z0-9]+)\\b[^>]*\\sitemprop\\s*=\\s*["']?${prop}["']?[^>]*>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const fromAttr =
      kind === 'url'
        ? attr(tag, 'content') || attr(tag, 'src') || attr(tag, 'href') || attr(tag, 'data-src')
        : attr(tag, 'content');
    if (fromAttr && fromAttr.trim()) {
      return kind === 'url' ? absUrl(fromAttr, base) : decodeEntities(fromAttr);
    }
    if (kind === 'text') {
      const rest = html.slice(m.index + tag.length, m.index + tag.length + 2000);
      const end = rest.search(new RegExp(`</${m[1]}>`, 'i'));
      const text = decodeEntities(
        (end >= 0 ? rest.slice(0, end) : rest.slice(0, 200)).replace(/<[^>]+>/g, ' ')
      );
      if (text) return text;
    }
  }
  return null;
}

// -- main -------------------------------------------------------------------

/**
 * The product on a page, from its HTML and address. Only what's found is set;
 * a price with no recognisable currency is left out (a currency is suggested,
 * never guessed), and a data: image is ignored.
 */
export function extractProduct(html: string, url: string): ProductData {
  let name: string | null = null;
  let image: string | null = null;
  let price: RawPrice | null = null;

  // 1. JSON-LD
  const nodes: Json[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const data = parseJsonLd(m[1]);
    if (data !== undefined) collectNodes(data, nodes);
  }
  // Prefer the product that carries an offer, then any with a name.
  const ranked = [...nodes].sort(
    (a, b) => Number(!!priceOfProduct(b)) - Number(!!priceOfProduct(a))
  );
  for (const n of ranked) {
    name ??= str(n.name);
    image ??= imageOf(n.image, url);
    price ??= priceOfProduct(n);
  }

  // 2. Open Graph / twitter / product:price
  const meta = metaMap(html);
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = meta.get(k);
      if (v) return v;
    }
    return null;
  };
  name ??= pick('og:title', 'twitter:title');
  image ??= absUrl(
    pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'),
    url
  );
  const ogAmount = parseAmount(
    pick('product:price:amount', 'og:price:amount', 'product:sale_price:amount')
  );
  if (ogAmount != null) {
    const og: RawPrice = {
      amount: ogAmount,
      currency: currencyCode(
        pick('product:price:currency', 'og:price:currency', 'product:sale_price:currency')
      ),
    };
    // One Shopify theme writes the JSON-LD price in minor units ("23000" for
    // 230,00) while its OG price is right: when they differ by exactly x100,
    // trust OG.
    const inMinorUnits =
      price != null && Math.round(price.amount * 100) === Math.round(og.amount * 100) * 100;
    if (!price || inMinorUnits) price = { ...og, currency: og.currency ?? price?.currency ?? null };
  }

  // 3. Microdata (itemprop outside <meta> too)
  if (/itemtype\s*=\s*["']?https?:\/\/schema\.org\/Product/i.test(html)) {
    name ??= itemprop(html, 'name', url, 'text');
    image ??= itemprop(html, 'image', url, 'url');
    if (!price) {
      const raw = itemprop(html, 'price', url, 'text') ?? itemprop(html, 'lowPrice', url, 'text');
      const amount = parseAmount(raw);
      if (amount != null) {
        const curRaw = itemprop(html, 'priceCurrency', url, 'text');
        price = { amount, currency: currencyCode(curRaw ?? raw) };
      }
    }
  }

  // 4. <title> as a last-resort name
  if (!name) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    name = t ? decodeEntities(t[1]) || null : null;
  }

  const out: ProductData = { link: url };
  const cleaned = name ? cleanProductName(name) : '';
  if (cleaned) out.name = cleaned;
  if (image) out.imageUrl = image;
  if (price?.currency) {
    out.price = { cents: Math.round(price.amount * 100), currency: price.currency };
  }
  return out;
}
