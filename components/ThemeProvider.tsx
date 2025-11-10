'use client';

import { createContext, useContext } from 'react';

/**
 * Theme context that provides theme configuration to client components
 */
interface ThemeContextType {
  siteTitle: string;
  siteDescription: string;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

/**
 * ThemeProvider component that provides theme values to client components
 * Theme values are passed from the server component (layout.tsx) to avoid hydration mismatches
 */
export function ThemeProvider({ 
  children,
  siteTitle,
  siteDescription,
}: { 
  children: React.ReactNode;
  siteTitle: string;
  siteDescription: string;
}) {
  return (
    <ThemeContext.Provider value={{ siteTitle, siteDescription }}>
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

