import { describe, it, expect } from 'vitest';
import { createAcceptRedirect } from '@/lib/utils/acceptRedirect';

describe('createAcceptRedirect — the last accept clicked wins', () => {
  it('redirects a lone accept as soon as it succeeds', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    expect(r.joined('a', '/wishlists/a')).toBe('/wishlists/a');
  });

  it('holds an earlier accept that succeeds first, then redirects the later one', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    expect(r.joined('a', '/wishlists/a')).toBeNull();
    expect(r.joined('b', '/wishlists/b')).toBe('/wishlists/b');
  });

  it('redirects the later accept at once, and the earlier one never', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    expect(r.joined('b', '/wishlists/b')).toBe('/wishlists/b');
    expect(r.joined('a', '/wishlists/a')).toBeNull();
    expect(r.failed('a')).toBeNull();
  });

  it('falls back to an earlier accept that already succeeded once the later one fails', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    expect(r.joined('a', '/wishlists/a')).toBeNull();
    expect(r.failed('b')).toBe('/wishlists/a');
  });

  it('lets an earlier accept redirect when it succeeds after the later one failed', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    expect(r.failed('b')).toBeNull();
    expect(r.joined('a', '/wishlists/a')).toBe('/wishlists/a');
  });

  it('waits for every later accept to fail before falling back', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    r.clicked('c');
    expect(r.joined('a', '/wishlists/a')).toBeNull();
    expect(r.failed('c')).toBeNull();
    expect(r.failed('b')).toBe('/wishlists/a');
  });

  it('a failure in the middle changes nothing while the last one is pending', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    r.clicked('c');
    expect(r.joined('a', '/wishlists/a')).toBeNull();
    expect(r.failed('b')).toBeNull();
    expect(r.joined('c', '/wishlists/c')).toBe('/wishlists/c');
  });

  it('a retried accept counts as clicked again', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    expect(r.failed('a')).toBeNull();
    r.clicked('a');
    expect(r.joined('b', '/wishlists/b')).toBeNull();
    expect(r.joined('a', '/wishlists/a')).toBe('/wishlists/a');
  });

  it('an accept clicked after a redirect redirects in its turn', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    expect(r.joined('a', '/wishlists/a')).toBe('/wishlists/a');
    r.clicked('b');
    expect(r.joined('b', '/wishlists/b')).toBe('/wishlists/b');
  });

  it('forgets every accept on reset', () => {
    const r = createAcceptRedirect();
    r.clicked('a');
    r.clicked('b');
    expect(r.joined('a', '/wishlists/a')).toBeNull();
    r.reset();
    expect(r.failed('b')).toBeNull();
    expect(r.joined('b', '/wishlists/b')).toBeNull();
  });
});
