'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import {
  DARK_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  parseThemeChoice,
  resolveTheme,
  type ResolvedTheme,
  type ThemeChoice,
} from '@/lib/utils/theme';

interface ThemeContextValue {
  /** The choice: Light, Dark or System (the default). */
  theme: ThemeChoice;
  /** What the page is drawn in: the choice, or the OS's setting while on System. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function osPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_SCHEME_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * The theme the page is showing: `<html data-theme>`, which the layout's inline
 * script sets before paint (resolving System from the OS) and `applyTheme`
 * keeps current. Read it where the theme has to be right on the first client
 * render, e.g. for a third-party widget that takes it once. Needs no provider.
 * Client-only.
 */
export function appliedTheme(): ResolvedTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // System is the default. An inline script in <head> sets the attribute before
  // paint (no flash); here we sync React state to whatever was chosen.
  const [theme, setThemeState] = useState<ThemeChoice>('system');
  const [prefersDark, setPrefersDark] = useState(false);
  // Until the saved choice and the OS setting are read, leave <html> as the
  // inline script set it: applying the initial state would flash it to light.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setThemeState(parseThemeChoice(stored));
    setPrefersDark(osPrefersDark());
    setReady(true);
  }, []);

  // Follow the OS live (it only matters while on System, but tracking it
  // always keeps `resolvedTheme` right the moment the choice flips).
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia(DARK_SCHEME_QUERY);
    } catch {
      return;
    }
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = resolveTheme(theme, prefersDark);

  useEffect(() => {
    if (ready) applyTheme(resolvedTheme);
  }, [ready, resolvedTheme]);

  const setTheme = (next: ThemeChoice) => {
    setThemeState(next);
    try {
      if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
