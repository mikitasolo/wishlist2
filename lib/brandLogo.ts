/**
 * The brand logo, mirroring app/icon.svg (the favicon), for the share cards
 * (lib/og/cards.tsx draws it), which can't load that file by URL. A test keeps
 * the two the same. The email header uses a PNG pre-rendered from app/icon.svg
 * instead (lib/emailLogo.ts).
 */
export const LOGO_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#8f8dff"/><stop offset="0.5" stop-color="#5e5ce6"/><stop offset="1" stop-color="#4644c0"/>
    </linearGradient>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#g)"/>
  <rect x="18.5" y="27" width="27" height="19" rx="4.5" fill="#fff"/>
  <rect x="29.4" y="27" width="5.2" height="19" fill="#5e5ce6"/>
  <path d="M32 27 21.5 20.5 23.6 28.5Z" fill="#fff"/>
  <path d="M32 27 42.5 20.5 40.4 28.5Z" fill="#fff"/>
  <circle cx="32" cy="26.4" r="2.8" fill="#fff"/>
</svg>`;
