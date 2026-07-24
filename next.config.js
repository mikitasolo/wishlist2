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
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // Vercel Blob serves public images over https; next/image also emits data URIs.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
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

const nextConfig = {
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
