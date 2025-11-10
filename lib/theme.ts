/**
 * Theme configuration based on environment variables
 * Each Vercel project must provide all theme values via env vars
 */

export interface ThemeConfig {
  // Primary color palette (hex values)
  primary50: string;
  primary100: string;
  primary200: string;
  primary300: string;
  primary400: string;
  primary500: string;
  primary600: string;
  primary700: string;
  primary800: string;
  primary900: string;
  
  // Background colors (RGB values)
  backgroundStartRgb: string; // Format: "252, 231, 243"
  backgroundEndRgb: string;   // Format: "255, 255, 255"
  
  // Foreground color (RGB values)
  foregroundRgb: string;      // Format: "0, 0, 0"
  
  // Site metadata
  siteTitle: string;
  siteDescription: string;
}

/**
 * Get theme configuration from environment variables
 * Note: Environment variable validation is handled by validateEnvVars() in lib/env.ts
 */
export function getThemeConfig(): ThemeConfig {
  
  return {
    primary50: process.env.THEME_PRIMARY_50!,
    primary100: process.env.THEME_PRIMARY_100!,
    primary200: process.env.THEME_PRIMARY_200!,
    primary300: process.env.THEME_PRIMARY_300!,
    primary400: process.env.THEME_PRIMARY_400!,
    primary500: process.env.THEME_PRIMARY_500!,
    primary600: process.env.THEME_PRIMARY_600!,
    primary700: process.env.THEME_PRIMARY_700!,
    primary800: process.env.THEME_PRIMARY_800!,
    primary900: process.env.THEME_PRIMARY_900!,
    backgroundStartRgb: process.env.THEME_BACKGROUND_START_RGB!,
    backgroundEndRgb: process.env.THEME_BACKGROUND_END_RGB!,
    foregroundRgb: process.env.THEME_FOREGROUND_RGB!,
    siteTitle: process.env.SITE_TITLE!,
    siteDescription: process.env.SITE_DESCRIPTION!,
  };
}

/**
 * Convert hex color to rgba
 */
export function hexToRgba(hex: string, alpha: number): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return `rgba(0, 0, 0, ${alpha})`;
  
  const r = parseInt(result[1], 16);
  const g = parseInt(result[2], 16);
  const b = parseInt(result[3], 16);
  
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Generate CSS variables string for injection into globals.css
 * This is used at build time to inject theme colors
 */
export function generateThemeCSS(): string {
  const theme = getThemeConfig();
  
  return `
    --color-primary-50: ${theme.primary50};
    --color-primary-100: ${theme.primary100};
    --color-primary-200: ${theme.primary200};
    --color-primary-300: ${theme.primary300};
    --color-primary-400: ${theme.primary400};
    --color-primary-500: ${theme.primary500};
    --color-primary-600: ${theme.primary600};
    --color-primary-700: ${theme.primary700};
    --color-primary-800: ${theme.primary800};
    --color-primary-900: ${theme.primary900};
  `.trim();
}

