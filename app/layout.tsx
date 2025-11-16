import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import SessionProvider from '@/components/SessionProvider';
import { ToastProvider } from '@/components/ToastProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { validateEnvVars } from '@/lib/env';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

// Validate all environment variables at startup
validateEnvVars();

export const metadata: Metadata = {
  title: 'Wishlist',
  description: 'Create and share your wishlist',
  icons: {
    icon: [
      {
        url: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎁</text></svg>',
      },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ErrorBoundary>
          <SessionProvider>
            <ToastProvider>{children}</ToastProvider>
          </SessionProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
