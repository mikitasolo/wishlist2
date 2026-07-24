// Parse Open Graph / meta tags out of an HTML page into fields the item form
// can pre-fill. Pure and dependency-free (regex over the markup), so it's easy
// to unit-test and safe to run in the import route.

export interface LinkMetadata {
  title: string | null;
  imageUrl: string | null;
  description: string | null;
  // Price normalized to integer cents + lowercase currency, matching how the
  // app stores money. Null unless both an amount and currency were found.
  price: { value: number; currency: string } | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m =
    tag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i')) ||
    tag.match(new RegExp(`${name}\\s*=\\s*'([^']*)'`, 'i'));
  return m ? m[1] : null;
}

/** Map of meta property/name → content for every <meta> tag in the document. */
function metaMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop');
    const content = attr(tag, 'content');
    if (key && content != null && !map.has(key.toLowerCase())) {
      map.set(key.toLowerCase(), decodeEntities(content));
    }
  }
  return map;
}

export function parseLinkMetadata(html: string, baseUrl: string): LinkMetadata {
  const meta = metaMap(html);
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = meta.get(k);
      if (v) return v;
    }
    return null;
  };

  // Title: OG first, then the document <title>.
  let title = pick('og:title', 'twitter:title');
  if (!title) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) title = decodeEntities(m[1].replace(/\s+/g, ' '));
  }

  // Image: prefer secure OG image; resolve relative URLs; http/https only.
  let imageUrl: string | null = null;
  const rawImg = pick('og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image');
  if (rawImg) {
    try {
      const resolved = new URL(rawImg, baseUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        imageUrl = resolved.href;
      }
    } catch {
      /* ignore an unparseable image URL */
    }
  }

  const description = pick('og:description', 'twitter:description', 'description');

  // Price: OG/product amount + currency, normalized to integer cents.
  let price: { value: number; currency: string } | null = null;
  const amountStr = pick('og:price:amount', 'product:price:amount', 'twitter:data1');
  const currencyStr = pick('og:price:currency', 'product:price:currency');
  if (amountStr && currencyStr) {
    const amount = parseFloat(amountStr.replace(/[^0-9.]/g, ''));
    const currency = currencyStr.trim().toLowerCase();
    if (Number.isFinite(amount) && amount > 0 && /^[a-z]{3}$/.test(currency)) {
      price = { value: Math.round(amount * 100), currency };
    }
  }

  return {
    title: title || null,
    imageUrl,
    description: description || null,
    price,
  };
}
