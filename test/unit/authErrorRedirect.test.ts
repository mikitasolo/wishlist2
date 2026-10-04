import { describe, it, expect } from 'vitest';
import { isEmailCallbackPath, verificationErrorLocation } from '@/lib/utils/authErrorRedirect';

// regression: an expired or used magic link lost its destination on the error
// page, since Auth.js's redirect there carries only the error type (WIS-305).

const ORIGIN = 'http://localhost:3000';
const ERROR = `${ORIGIN}/auth/error?error=Verification`;
const link = (callbackUrl?: string) => {
  const url = new URL(`${ORIGIN}/api/auth/callback/nodemailer?token=t&email=a%40b.c`);
  if (callbackUrl !== undefined) url.searchParams.set('callbackUrl', callbackUrl);
  return url;
};

describe('isEmailCallbackPath', () => {
  it.each([
    ['/api/auth/callback/nodemailer', true],
    ['/api/auth//callback//nodemailer/', true],
    ['/api/auth/callback/other', false],
    ['/api/auth/callback/nodemailer/extra', false],
    ['/api/auth/signin/nodemailer', false],
    ['/api/auth/callback', false],
    ['/other/callback/nodemailer', false],
  ])('%s → %s', (path, expected) => {
    expect(isEmailCallbackPath(path)).toBe(expected);
  });
});

describe('verificationErrorLocation', () => {
  it('adds a same-site callbackUrl to the Verification redirect, as a path', () => {
    expect(verificationErrorLocation(link(`${ORIGIN}/wishlists/x?item=1#top`), ERROR, ORIGIN)).toBe(
      `${ERROR}&callbackUrl=${encodeURIComponent('/wishlists/x?item=1#top')}`
    );
  });

  it('keeps the redirect’s own origin and parameters', () => {
    const location = 'https://staging.example/auth/error?error=Verification&code=x';
    expect(verificationErrorLocation(link('/booked'), location, ORIGIN)).toBe(
      'https://staging.example/auth/error?error=Verification&code=x&callbackUrl=%2Fbooked'
    );
  });

  it.each([
    ['another host', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['a protocol-relative path', `${ORIGIN}//evil.example`],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['an auth page', '/auth/signin?callbackUrl=%2Fbooked'],
    ['the auth section itself', '/auth'],
    ['home', '/'],
    ['empty', ''],
  ])('leaves the redirect alone for a callbackUrl that is %s', (_label, callbackUrl) => {
    expect(verificationErrorLocation(link(callbackUrl), ERROR, ORIGIN)).toBeNull();
  });

  it('leaves the redirect alone without a callbackUrl', () => {
    expect(verificationErrorLocation(link(), ERROR, ORIGIN)).toBeNull();
  });

  it.each([
    ['no Location', null],
    ['a redirect to the destination', `${ORIGIN}/booked`],
    ['another error', `${ORIGIN}/auth/error?error=Configuration`],
    ['another page', `${ORIGIN}/auth/signin?error=Verification`],
    ['one that already names a callbackUrl', `${ERROR}&callbackUrl=%2Fitems`],
  ])('leaves %s alone', (_label, location) => {
    expect(verificationErrorLocation(link('/booked'), location, ORIGIN)).toBeNull();
  });

  it('leaves any other Auth.js path alone', () => {
    const url = new URL(`${ORIGIN}/api/auth/signin/nodemailer?callbackUrl=%2Fbooked`);
    expect(verificationErrorLocation(url, ERROR, ORIGIN)).toBeNull();
  });
});
