// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

const { session } = vi.hoisted(() => ({
  session: { status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated' },
}));

vi.mock('next-auth/react', () => ({
  SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useSession: () => ({ data: null, status: session.status }),
}));

import SessionProvider from '@/components/SessionProvider';
import {
  SESSION_HINT_ATTRIBUTE,
  SESSION_HINT_KEY,
  SESSION_HINT_SCRIPT,
} from '@/lib/utils/sessionHint';

const root = () => document.documentElement;

beforeEach(() => {
  cleanup();
  localStorage.clear();
  root().removeAttribute(SESSION_HINT_ATTRIBUTE);
});

describe('the session hint (WIS-209)', () => {
  it('is remembered once the session turns out signed in', () => {
    session.status = 'authenticated';
    render(<SessionProvider>page</SessionProvider>);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
    expect(root()).toHaveAttribute(SESSION_HINT_ATTRIBUTE);
  });

  it('is forgotten once the session turns out signed out', () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    root().setAttribute(SESSION_HINT_ATTRIBUTE, '');
    session.status = 'unauthenticated';
    render(<SessionProvider>page</SessionProvider>);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBeNull();
    expect(root()).not.toHaveAttribute(SESSION_HINT_ATTRIBUTE);
  });

  it('is left as it is while the session loads', () => {
    localStorage.setItem(SESSION_HINT_KEY, '1');
    session.status = 'loading';
    render(<SessionProvider>page</SessionProvider>);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
  });

  it("is put on <html> before paint by the layout's inline script, only when remembered", () => {
    new Function(SESSION_HINT_SCRIPT)();
    expect(root()).not.toHaveAttribute(SESSION_HINT_ATTRIBUTE);

    localStorage.setItem(SESSION_HINT_KEY, '1');
    new Function(SESSION_HINT_SCRIPT)();
    expect(root()).toHaveAttribute(SESSION_HINT_ATTRIBUTE);
  });

  it('carries nothing about who was signed in', () => {
    session.status = 'authenticated';
    render(<SessionProvider>page</SessionProvider>);
    expect(Object.keys(localStorage)).toEqual([SESSION_HINT_KEY]);
    expect(localStorage.getItem(SESSION_HINT_KEY)).toBe('1');
  });
});
