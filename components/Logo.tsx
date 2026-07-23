/**
 * The Wishlist app mark: a minimalist wrapped-gift glyph (box + ribbon + bow)
 * on a brand-indigo gradient squircle. Also mirrored in app/icon.svg (favicon).
 */
export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wl-logo-grad" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8f8dff" />
          <stop offset="0.5" stopColor="#5e5ce6" />
          <stop offset="1" stopColor="#4644c0" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="17" fill="url(#wl-logo-grad)" />
      {/* box */}
      <rect x="18.5" y="27" width="27" height="19" rx="4.5" fill="#fff" />
      {/* vertical ribbon */}
      <rect x="29.4" y="27" width="5.2" height="19" fill="#5e5ce6" />
      {/* bow */}
      <path d="M32 27 21.5 20.5 23.6 28.5Z" fill="#fff" />
      <path d="M32 27 42.5 20.5 40.4 28.5Z" fill="#fff" />
      <circle cx="32" cy="26.4" r="2.8" fill="#fff" />
    </svg>
  );
}
