import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import SessionProvider from '@/components/SessionProvider'
import { ToastProvider } from '@/components/ToastProvider'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ThemeProvider } from '@/components/ThemeProvider'
import { getThemeConfig } from '@/lib/theme'
import { validateEnvVars } from '@/lib/env'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

// Validate all environment variables at startup
validateEnvVars()

// Get theme config for metadata (server-side)
const theme = getThemeConfig()

export const metadata: Metadata = {
  title: theme.siteTitle,
  description: theme.siteDescription,
  icons: {
    icon: [
      {
        url: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎁</text></svg>',
      },
    ],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Inject CSS variables server-side to avoid flash of unstyled content
  const themeStyle = {
    '--theme-primary-50': theme.primary50,
    '--theme-primary-100': theme.primary100,
    '--theme-primary-200': theme.primary200,
    '--theme-primary-300': theme.primary300,
    '--theme-primary-400': theme.primary400,
    '--theme-primary-500': theme.primary500,
    '--theme-primary-600': theme.primary600,
    '--theme-primary-700': theme.primary700,
    '--theme-primary-800': theme.primary800,
    '--theme-primary-900': theme.primary900,
    '--theme-background-start-rgb': theme.backgroundStartRgb,
    '--theme-background-end-rgb': theme.backgroundEndRgb,
    '--theme-foreground-rgb': theme.foregroundRgb,
  } as React.CSSProperties

  return (
    <html lang="en" style={themeStyle}>
      <body className={inter.className}>
        <ThemeProvider>
          <ErrorBoundary>
            <SessionProvider>
              <ToastProvider>{children}</ToastProvider>
            </SessionProvider>
          </ErrorBoundary>
        </ThemeProvider>
      </body>
    </html>
  )
}
