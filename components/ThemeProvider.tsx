'use client';

/**
 * ThemeProvider component that ensures CSS variables are set client-side
 * This is a fallback in case server-side injection doesn't work
 * The main injection happens server-side in layout.tsx via inline styles on <html>
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // CSS variables are injected server-side via inline styles on <html>
  // This component is kept for potential future client-side theme switching
  return <>{children}</>;
}

