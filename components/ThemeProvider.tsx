'use client';

import { createContext, useContext } from 'react';
import { getThemeConfig } from '@/lib/theme';

/**
 * Theme context that provides theme configuration to client components
 */
interface ThemeContextType {
  siteTitle: string;
  siteDescription: string;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * ThemeProvider component that ensures CSS variables are set client-side
 * This is a fallback in case server-side injection doesn't work
 * The main injection happens server-side in layout.tsx via inline styles on <html>
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Get theme config - this works because getThemeConfig reads from process.env
  // which is available at build time in Next.js
  const theme = getThemeConfig();
  
  return (
    <ThemeContext.Provider value={{ siteTitle: theme.siteTitle, siteDescription: theme.siteDescription }}>
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Hook to access theme configuration in client components
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

