import type { Metadata } from 'next';
import SessionProvider from '@/components/SessionProvider';
import { ToastProvider } from '@/components/ToastProvider';
import { ThemeProvider } from '@/components/ThemeProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { validateEnvVars } from '@/lib/env';
import './globals.css';

// Validate all environment variables at startup
validateEnvVars();

export const metadata: Metadata = {
  title: 'Wishlist',
  description: 'Create and share your wishlist',
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
