/**
 * The scrub every error report goes through before it leaves for Sentry
 * (WIS-381): `beforeSend` and `beforeBreadcrumb` on both the server
 * (`instrumentation.ts`) and the browser (`lib/monitoring/browser.ts`). Error
 * reports answer to the same rule as the logs (docs/agents/backend.md): no
 * personal data. Nothing in here imports the SDK, so it costs no bundle and is
 * tested on its own (`test/unit/monitoringScrub.test.ts`).
 *
 * What it takes out, wherever it turns up:
 *  - the person: `event.user`, the request's cookies, its headers but the user
 *    agent (so the session cookie, `Authorization`, `X-Share-Token`, the
 *    `Referer`), body, query string and environment;
 *  - in every string (a message, an exception's value, a breadcrumb, a context,
 *    a tag, the request URL): email addresses, every URL's query and fragment
 *    (a magic link's `token` / `email` / `callbackUrl`, an unsubscribe link's
 *    signature), a share link's token (`/l/<token>`), a username in a profile
 *    path, a record id (a user id is one), a bare share-token-shaped word, and a
 *    MongoDB duplicate-key error's value;
 *  - under a personal-sounding key (`email`, `name`, `username`, `token`,
 *    `cookie`, `body`…) in `extra` or a breadcrumb's data: the whole value;
 *  - DOM breadcrumbs (a click's selector can carry an avatar's alt text, a
 *    person's name), and the raw arguments of a console breadcrumb.
 *
 * Stack frames keep their function names, line numbers and source lines (our
 * own code, which grouping and source maps depend on), but lose their local
 * variables (`vars`), and a frame's file URL is scrubbed like any URL: code
 * inline in the page names the page's own URL, query and all.
 */

/** Stands in for anything taken out. */
export const FILTERED = '[Filtered]';

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * A share token's shape (22 base62, `generateShareToken`) as a word of its own.
 * Anything but an all-lowercase word: a token has no digit about 2% of the
 * time, and a 22-letter camelCase name taken out now and then is the price.
 */
const SHARE_TOKEN_WORD_RE =
  /(?<![A-Za-z0-9])(?=[A-Za-z0-9]*[A-Z0-9])[A-Za-z0-9]{22}(?![A-Za-z0-9])/g;

/** A record id (a MongoDB ObjectId, a user's included) or any longer hex run: a hashed token. */
const HEX_ID_RE = /(?<![A-Za-z0-9])[0-9a-f]{24,}(?![A-Za-z0-9])/gi;

/** `token=…`, `email=…` and the like outside a URL (a URL loses its whole query). */
const SECRET_PARAM_RE =
  /\b(token|email|callbackUrl|code|sig|signature|secret|password)=[^&\s"'<>]+/gi;

/** A MongoDB duplicate-key error quotes the value it refused (an email, a username). */
const DUP_KEY_RE = /dup key: \{[^}]*\}/g;

/**
 * A URL or an absolute path inside free text: `https://…`, or `/…` not preceded
 * by a word character or another slash (so `a/b` and `//` aren't taken).
 */
const URLISH_RE = /https?:\/\/[^\s"'<>()]+|(?<![\w/:.])\/[^\s"'<>()]*/g;

/**
 * Path segments that name a person or hold a credential, as their route's
 * pattern. A list's id is reduced too (`/wishlists/[id]`): it may be a slug.
 */
const PATH_RULES: readonly [RegExp, string][] = [
  [/^\/l\/[^/]+/, '/l/[token]'],
  [/^\/users\/[^/]+/, '/users/[username]'],
  [/^\/api\/users\/by-username\/[^/]+/, '/api/users/by-username/[username]'],
  [
    /^\/api\/users\/(?!me(?:\/|$)|check-username(?:\/|$)|by-username(?:\/|$))[^/]+/,
    '/api/users/[id]',
  ],
  [/^\/wishlists\/(?!mine(?:\/|$)|shared(?:\/|$))[^/]+/, '/wishlists/[id]'],
  [/^\/api\/wishlists\/[^/]+/, '/api/wishlists/[id]'],
];

/** A path with every personal or secret segment replaced by its name. */
export function scrubPath(path: string): string {
  let p = path;
  for (const [re, pattern] of PATH_RULES) {
    if (re.test(p)) {
      p = p.replace(re, pattern);
      break;
    }
  }
  return p.replace(HEX_ID_RE, '[id]').replace(SHARE_TOKEN_WORD_RE, '[token]');
}

/**
 * A URL (absolute or a path) with no query or fragment and its path scrubbed;
 * an absolute URL keeps its origin. Anything after a `?` or `#` goes whole:
 * a magic link's token and email, a callback URL, an unsubscribe signature.
 */
export function scrubUrl(url: string): string {
  const cut = url.search(/[?#]/);
  const bare = cut === -1 ? url : url.slice(0, cut);
  const m = /^(https?:\/\/[^/]*)(\/.*)?$/i.exec(bare);
  if (m) return m[1].replace(EMAIL_RE, FILTERED) + scrubPath(m[2] ?? '');
  return scrubPath(bare);
}

/** Free text with every personal value or credential in it replaced. */
export function scrubString(value: string): string {
  return value
    .replace(DUP_KEY_RE, `dup key: ${FILTERED}`)
    .replace(URLISH_RE, (u) => scrubUrl(u))
    .replace(SECRET_PARAM_RE, (_m, key: string) => `${key}=${FILTERED}`)
    .replace(EMAIL_RE, FILTERED)
    .replace(HEX_ID_RE, '[id]')
    .replace(SHARE_TOKEN_WORD_RE, '[token]');
}

/** Keys whose value is personal or secret whatever it holds. */
const SENSITIVE_KEY_RE =
  /email|e-mail|^name$|username|displayname|fullname|first_?name|last_?name|token|cookie|auth|password|secret|session|^body$|^data$|request_body|ip_address|^ip$|referr?er|^user$|birthday/i;

const MAX_DEPTH = 8;

/**
 * Every string in `value` scrubbed, deeply. With `byKey`, the whole value under
 * a personal-sounding key goes too (only for free-form bags: `extra`, a
 * breadcrumb's data; not for contexts, where `os.name` is a browser's name).
 */
export function scrubDeep(value: unknown, byKey: boolean, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return FILTERED;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, byKey, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = byKey && SENSITIVE_KEY_RE.test(k) ? FILTERED : scrubDeep(v, byKey, depth + 1);
  }
  return out;
}

/** The parts of an event (Sentry's `Event`) this scrub reads or writes. */
export interface ScrubbableEvent {
  message?: string;
  logentry?: { message?: string; params?: unknown[] };
  transaction?: string;
  user?: unknown;
  request?: {
    url?: string;
    method?: string;
    cookies?: unknown;
    headers?: unknown;
    data?: unknown;
    query_string?: unknown;
    env?: unknown;
  };
  exception?: {
    values?: {
      type?: string;
      value?: string;
      stacktrace?: { frames?: { vars?: unknown; filename?: string; abs_path?: string }[] };
    }[];
  };
  breadcrumbs?: ScrubbableBreadcrumb[];
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** The parts of a breadcrumb (Sentry's `Breadcrumb`) this scrub reads or writes. */
export interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/**
 * A breadcrumb fit to send, or `null` to drop it: DOM breadcrumbs go (a
 * selector can name a person), a console breadcrumb keeps only its scrubbed
 * message, any other keeps a scrubbed message and data.
 */
export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(crumb: B): B | null {
  const category = crumb.category ?? '';
  if (category.startsWith('ui.')) return null;
  const out = { ...crumb };
  if (typeof out.message === 'string') out.message = scrubString(out.message);
  if (category === 'console') {
    delete out.data;
  } else if (out.data) {
    out.data = scrubDeep(out.data, true) as Record<string, unknown>;
  }
  return out;
}

/**
 * A stack frame's file: a URL loses its query and fragment and has its path
 * scrubbed (a `/_next/static/…` chunk is untouched by that); a server path
 * (`/var/task/.next/server/…`) or `<anonymous>` is kept as it is.
 */
function scrubFrameFile(file: string): string {
  return /^https?:\/\//i.test(file) ? scrubUrl(file) : file;
}

function userAgentOf(headers: unknown): string | null {
  if (!headers || typeof headers !== 'object') return null;
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    if (k.toLowerCase() === 'user-agent' && typeof v === 'string') return scrubString(v);
  }
  return null;
}

/** An event fit to send: see the top of this file for what's taken out. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const out: E = { ...event };
  delete out.user;

  if (out.request) {
    // Rebuilt from an allowlist: the URL (scrubbed), the method, and the user
    // agent (which browser broke). Every other header goes: the session
    // cookie, `Authorization`, `X-Share-Token`, the `Referer`.
    const { url, method, headers } = out.request;
    const userAgent = userAgentOf(headers);
    out.request = {
      ...(url !== undefined ? { url: scrubUrl(url) } : {}),
      ...(method !== undefined ? { method } : {}),
      ...(userAgent ? { headers: { 'User-Agent': userAgent } } : {}),
    };
  }

  if (typeof out.message === 'string') out.message = scrubString(out.message);
  if (out.logentry) {
    out.logentry = {
      ...(out.logentry.message !== undefined ? { message: scrubString(out.logentry.message) } : {}),
      // A format's params are what it was given: scrubbed like anything else.
      ...(out.logentry.params ? { params: scrubDeep(out.logentry.params, true) as unknown[] } : {}),
    };
  }
  if (typeof out.transaction === 'string') out.transaction = scrubString(out.transaction);

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => ({
        ...v,
        ...(typeof v.value === 'string' ? { value: scrubString(v.value) } : {}),
        ...(v.stacktrace?.frames
          ? {
              stacktrace: {
                ...v.stacktrace,
                // A frame's local variables are whatever the code held: never
                // sent. Its file is a URL for browser code (the page's own,
                // query and all, for inline code): scrubbed like one.
                frames: v.stacktrace.frames.map((f) => {
                  const frame = { ...f };
                  delete frame.vars;
                  if (typeof frame.filename === 'string')
                    frame.filename = scrubFrameFile(frame.filename);
                  if (typeof frame.abs_path === 'string')
                    frame.abs_path = scrubFrameFile(frame.abs_path);
                  return frame;
                }),
              },
            }
          : {}),
      })),
    };
  }

  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs
      .map((b) => scrubBreadcrumb(b))
      .filter((b): b is ScrubbableBreadcrumb => b !== null);
  }

  if (out.contexts) {
    const contexts: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(out.contexts)) {
      // The trace context's ids are Sentry's own (hex), not ours to scrub.
      contexts[k] = k === 'trace' ? v : scrubDeep(v, false);
    }
    out.contexts = contexts;
  }
  if (out.tags) out.tags = scrubDeep(out.tags, true) as Record<string, unknown>;
  if (out.extra) out.extra = scrubDeep(out.extra, true) as Record<string, unknown>;

  return out;
}
