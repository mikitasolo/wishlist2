import type { Metadata } from 'next';
import SessionProvider from '@/components/SessionProvider';
import { ToastProvider } from '@/components/ToastProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { validateEnvVars } from '@/lib/env';
import './globals.css';

// Validate all environment variables at startup
validateEnvVars();

// Base URL so per-page og:image / canonical URLs resolve to absolute links for
// crawlers. Falls back to Vercel's deployment URL, then localhost in dev.
const baseUrl =
  process.env.NEXTAUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

// Shared, SEO-friendly defaults. `title.template` appends the brand to every
// per-page title (e.g. "Birthday · Wishlist"); `title.default` is used where a
// page sets none. The description sits in the 120–160 char sweet spot, and
// openGraph.siteName gives shared links their brand line (Discord etc.).
const DEFAULT_TITLE = 'Wishlist — share lists and reserve gifts, spoiler-free';
const DEFAULT_DESCRIPTION =
  'Create and share wishlists, follow friends and family, and reserve gifts for each other — no spoilers, no duplicate presents.';

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: DEFAULT_TITLE,
    template: '%s · Wishlist',
  },
  description: DEFAULT_DESCRIPTION,
  applicationName: 'Wishlist',
  openGraph: {
    siteName: 'Wishlist',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint to avoid a flash. Light is default. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','light');}})();",
          }}
        />
      </head>
      <body>
        <ErrorBoundary>
          <SessionProvider>
            <ThemeProvider>
              <ToastProvider>{children}</ToastProvider>
            </ThemeProvider>
          </SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
