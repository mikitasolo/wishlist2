import { describe, it, expect } from 'vitest';
import { parseThemeChoice, resolveTheme } from '@/lib/utils/theme';

describe('parseThemeChoice', () => {
  it('keeps a stored light or dark, and reads anything else as System', () => {
    expect(parseThemeChoice('light')).toBe('light');
    expect(parseThemeChoice('dark')).toBe('dark');
    expect(parseThemeChoice('system')).toBe('system');
    expect(parseThemeChoice(null)).toBe('system');
    expect(parseThemeChoice(undefined)).toBe('system');
    expect(parseThemeChoice('purple')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('%s with an OS preferring dark=%s draws %s', (choice, prefersDark, expected) => {
    expect(resolveTheme(choice, prefersDark)).toBe(expected);
  });

  it('resolves nothing stored the way System does', () => {
    expect(resolveTheme(parseThemeChoice(null), true)).toBe('dark');
    expect(resolveTheme(parseThemeChoice(null), false)).toBe('light');
  });
});
