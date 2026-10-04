// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';

type Listener = (e: { matches: boolean }) => void;
let dark = false;
let listeners: Listener[] = [];

function stubMatchMedia() {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    get matches() {
      return dark;
    },
    addEventListener: (_: string, l: Listener) => listeners.push(l),
    removeEventListener: (_: string, l: Listener) => {
      listeners = listeners.filter((x) => x !== l);
    },
  })) as unknown as typeof window.matchMedia;
}

function osChanges(next: boolean) {
  dark = next;
  act(() => listeners.forEach((l) => l({ matches: next })));
}

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <>
      <output data-testid="choice">{theme}</output>
      <button onClick={() => setTheme('system')}>system</button>
      <button onClick={() => setTheme('light')}>light</button>
    </>
  );
}

const html = () => document.documentElement.getAttribute('data-theme');
const mount = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>
  );

beforeEach(() => {
  cleanup();
  dark = false;
  listeners = [];
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  stubMatchMedia();
});
afterEach(() => localStorage.clear());

describe('ThemeProvider', () => {
  it('defaults to System, drawn as the OS prefers', () => {
    dark = true;
    mount();
    expect(screen.getByTestId('choice')).toHaveTextContent('system');
    expect(html()).toBe('dark');
  });

  it('follows a matchMedia change live while on System', () => {
    mount();
    expect(html()).toBe('light');
    osChanges(true);
    expect(html()).toBe('dark');
    osChanges(false);
    expect(html()).toBe('light');
  });

  it('keeps a stored light choice whatever the OS does', () => {
    dark = true;
    localStorage.setItem('theme', 'light');
    mount();
    expect(html()).toBe('light');
    osChanges(false);
    osChanges(true);
    expect(html()).toBe('light');
  });

  it('forgets the saved choice when System is picked again', async () => {
    localStorage.setItem('theme', 'dark');
    mount();
    expect(html()).toBe('dark');
    await userEvent.click(screen.getByText('system'));
    expect(localStorage.getItem('theme')).toBeNull();
    expect(html()).toBe('light');
    await userEvent.click(screen.getByText('light'));
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
