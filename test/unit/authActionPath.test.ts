import { describe, it, expect } from 'vitest';
import { isAuthActionPath } from '@/lib/utils/authActionPath';

describe('isAuthActionPath', () => {
  it.each([
    'providers',
    'session',
    'csrf',
    'signin',
    'signout',
    'callback',
    'verify-request',
    'error',
    'webauthn-options',
  ])('admits the %s action', (action) => {
    expect(isAuthActionPath(`/api/auth/${action}`)).toBe(true);
    expect(isAuthActionPath(`/api/auth/${action}/`)).toBe(true);
  });
  it.each(['signin', 'callback', 'webauthn-options'])('admits a provider for %s', (action) => {
    expect(isAuthActionPath(`/api/auth/${action}/nodemailer`)).toBe(true);
    expect(isAuthActionPath(`/api/auth//${action}//nodemailer/`)).toBe(true);
  });
  // regression: WIS-454. Invalid action paths caused Auth.js error reports.
  it.each([
    '/api/auth/*',
    '/api/auth/%2A',
    '/api/auth',
    '/api/auth/',
    '/api/auth/unknown',
    '/api/auth/session/provider',
    '/api/auth/csrf/provider',
    '/api/auth/callback/nodemailer/extra',
    '/api/authentic/session',
  ])('refuses %s', (path) => {
    expect(isAuthActionPath(path)).toBe(false);
  });
});
