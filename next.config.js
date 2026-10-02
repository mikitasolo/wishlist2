/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV !== 'production';

// Content-Security-Policy.
//
// Next.js injects inline bootstrap scripts and Tailwind ships inline styles, so
// a nonce-less policy has to allow 'unsafe-inline' for script/style. That still
// closes the high-value holes: clickjacking (frame-ancestors), plugin/object
// injection (object-src), <base> hijacking (base-uri), and off-site form
// submission (form-action). Dev additionally needs 'unsafe-eval' (React refresh)
// and a websocket connection (HMR).
//
// Follow-up for a stricter policy: nonce-based script-src via middleware, which
// lets us drop 'unsafe-inline' for scripts (tracked in the security notes).
//
// Cloudflare Turnstile on the sign-in form (components/TurnstileWidget.tsx)
// loads its script from, and renders its challenge in an iframe on,
// challenges.cloudflare.com: that one origin is allowed for script and frame,
// nothing else. On every route, not just /auth/signin: a client-side navigation
// to the sign-in page keeps the CSP of the page the visitor landed on.
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${TURNSTILE_ORIGIN}`,
  "style-src 'self' 'unsafe-inline'",
  // Vercel Blob serves public images over https; next/image also emits data URIs.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  `frame-src ${TURNSTILE_ORIGIN}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // Legacy clickjacking guard for browsers that ignore frame-ancestors.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  // Only meaningful over HTTPS; harmless on http://localhost.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

// sharp's native binding (`@img/sharp-<platform>/lib/sharp-*.node`) links the
// libvips shared library in `@img/sharp-libvips-<platform>/lib/` at load time.
// Next's output file tracing ships the binding but not the library it links,
// so on Vercel the first `import('sharp')` in a function fails with
// ERR_DLOPEN_FAILED (libvips-cpp.so…) and takes the whole route down with it
// (WIS-156: sign-in and uploads returned 500). So libvips ships with what runs
// sharp: the upload route, and the share cards below. Nothing else needs it any
// more. Sending an email used to render its logo with sharp, which put sharp in
// every API route (they import lib/auth) and in the sign-in page's server
// action, but the logo is pre-rendered now (lib/emailLogo.ts), so sign-in
// doesn't load sharp at all (WIS-208). Every page's trace still carries the
// binding, because Next imports the share cards' modules into each page for
// their metadata, but a page never draws a card, so it never loads sharp.
// `npm run check:trace` fails a build in which a route ships the binding
// without libvips, or NextAuth's route ships it at all.
const SHARP_NATIVE_LIBS = ['./node_modules/@img/sharp-libvips-*/lib/**/*'];

// The share cards (lib/og/) read their fonts from disk, and every one of them
// ships sharp's binding: next/og rasterizes a card with sharp when it can load
// it (falling back to its own wasm renderer when it can't), and a list's or
// profile's card converts its banner or avatar with it. So they ship libvips
// too, which `npm run check:trace` asserts after a build.
const SHARE_CARD_FILES = [...SHARP_NATIVE_LIBS, './lib/og/fonts/*.ttf'];

// User agents that get a page's metadata in <head>, before any of the page.
// Next streams a dynamic page's metadata into <body> for everyone else, which a
// link-preview bot that reads only the head (and runs no JavaScript) never
// sees, so a shared list or profile showed the site's defaults. Setting this
// replaces Next's own list, so it's that list plus the preview bots it lacks:
// Telegram (matched today only because its UA says "like TwitterBot"), Viber,
// Pinterest, Mastodon, Bluesky (Cardyb), Snapchat, OK.ru, Outlook/Teams, and the
// Iframely/Embedly unfurlers. Matching costs those agents nothing but waiting
// for the metadata, which takes at most METADATA_BUDGET_MS (lib/utils/og.ts):
// that includes a person in Viber's or Snapchat's in-app browser, if its user
// agent names the app. Next's list is read from Next's own module, so an
// upgrade that adds a bot keeps it. It isn't public API: should an upgrade move
// it, loading this config fails at once, rather than quietly dropping Google
// and the rest.
const NEXT_HTML_LIMITED_BOTS = require('next/dist/shared/lib/router/utils/html-bots')
  .HTML_LIMITED_BOT_UA_RE.source;
const LINK_PREVIEW_BOTS = [
  'TelegramBot',
  'Viber',
  'Pinterest',
  'Mastodon',
  'Bluesky',
  'Cardyb',
  'Snapchat',
  'OdklBot',
  'MicrosoftPreview',
  'Iframely',
  'Embedly',
];
const htmlLimitedBots = new RegExp(`${NEXT_HTML_LIMITED_BOTS}|${LINK_PREVIEW_BOTS.join('|')}`, 'i');

const nextConfig = {
  // `next dev` otherwise appends a managed "nextjs-agent-rules" block to
  // AGENTS.md whenever it detects an AI coding agent, leaving every workspace
  // that runs the dev server with an uncommitted change (WIS-171). AGENTS.md is
  // ours, written by hand.
  agentRules: false,
  // `next dev` otherwise logs every server function call with its arguments,
  // so the terminal prints the address typed into the sign-in form (its server
  // action, requestMagicLink), and whatever a later action takes (WIS-178).
  // Production never logs these. Other logging keeps Next's defaults.
  logging: { serverFunctions: false },
  htmlLimitedBots,
  outputFileTracingIncludes: {
    '/api/upload': SHARP_NATIVE_LIBS,
    '/opengraph-image': SHARE_CARD_FILES,
    '/wishlists/[id]/opengraph-image': SHARE_CARD_FILES,
    '/users/[username]/opengraph-image': SHARE_CARD_FILES,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

module.exports = nextConfig;
