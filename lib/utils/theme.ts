/** What the viewer picked: a fixed theme, or whatever their OS is set to. */
export type ThemeChoice = 'light' | 'dark' | 'system';
/** What the page is drawn in. */
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** A stored value as a choice: light and dark as saved, anything else (nothing, junk) is System. */
export function parseThemeChoice(stored: string | null | undefined): ThemeChoice {
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

/** The theme to draw for a choice, given whether the OS prefers dark. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ResolvedTheme {
  if (choice === 'system') return prefersDark ? 'dark' : 'light';
  return choice;
}
