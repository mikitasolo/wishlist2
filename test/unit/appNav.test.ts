import { describe, it, expect } from 'vitest';
import { activeDestination, meHref, navDestinations } from '@/lib/utils/appNav';

describe('navDestinations', () => {
  it('lists Home, Reserved, Activity and Me, in that order (D3)', () => {
    expect(navDestinations('mikita').map((d) => [d.label, d.href])).toEqual([
      ['Home', '/'],
      ['Reserved', '/booked'],
      ['Activity', '/notifications'],
      ['Me', '/users/mikita'],
    ]);
  });

  it('sends Me to Settings for an account with no username yet', () => {
    expect(meHref(null)).toBe('/settings');
    expect(meHref('')).toBe('/settings');
    expect(navDestinations(undefined).find((d) => d.id === 'me')?.href).toBe('/settings');
  });
});

describe('activeDestination', () => {
  it.each([
    ['/', 'home'],
    ['/wishlists/mine', 'home'],
    ['/wishlists/shared', 'home'],
    ['/items', 'home'],
    ['/items/', 'home'],
    ['/booked', 'reserved'],
    ['/notifications', 'activity'],
    ['/invites', 'activity'],
    ['/users/mikita', 'me'],
    ['/users/Mikita', 'me'],
  ])('marks %s as %s', (path, expected) => {
    expect(activeDestination(path, 'mikita')).toBe(expected);
  });

  // A list may be yours or someone else's, reached from anywhere: none of the
  // four is the page you're on.
  it.each([
    '/wishlists/e2e-birthday',
    '/wishlists/mine-too',
    '/users/alice',
    '/users/mikita/followers',
    '/settings',
    '/welcome',
    '/auth/signin',
  ])('marks nothing on %s', (path) => {
    expect(activeDestination(path, 'mikita')).toBeNull();
  });

  it('marks Me on Settings while you have no username, since that is where Me goes', () => {
    expect(activeDestination('/settings', null)).toBe('me');
    expect(activeDestination('/users/mikita', null)).toBeNull();
  });

  it('marks nothing without a path', () => {
    expect(activeDestination(null, 'mikita')).toBeNull();
  });
});
