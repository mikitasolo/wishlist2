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
// (WIS-156: sign-in and uploads returned 500). Ship libvips with every API
// route: the upload route runs sharp, and everything that reaches lib/email.ts
// (auth, the invite routes) can, and nearly every route imports lib/auth, so
// listing them one by one would miss the next one. The sign-in page too: its
// server action (app/auth/signin/actions.ts) sends the magic link, so it's the
// sign-in page's function, not /api/auth's, that renders the email's logo.
// `npm run check:trace` asserts after a build that every API route shipping the
// binding, and the sign-in page, ship libvips.
const SHARP_NATIVE_LIBS = ['./node_modules/@img/sharp-libvips-*/lib/**/*'];

const nextConfig = {
  outputFileTracingIncludes: {
    '/api/**/*': SHARP_NATIVE_LIBS,
    '/auth/signin': SHARP_NATIVE_LIBS,
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
