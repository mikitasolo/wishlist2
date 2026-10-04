// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { guardedHref, type LeaveClick } from '@/lib/utils/leaveGuard';

const HERE = new URL('https://wishlist.example/settings');

function anchor(href: string, attrs: Record<string, string> = {}) {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
  const inner = document.createElement('span');
  a.appendChild(inner);
  document.body.appendChild(a);
  return inner;
}

function click(target: EventTarget | null, over: Partial<LeaveClick> = {}): LeaveClick {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    target,
    ...over,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('guardedHref', () => {
  it('holds a plain click on a link to another page of the app, from inside the link', () => {
    expect(guardedHref(click(anchor('/wishlists/mine?x=1#top')), HERE)).toBe(
      '/wishlists/mine?x=1#top'
    );
    expect(guardedHref(click(anchor('https://wishlist.example/')), HERE)).toBe('/');
  });

  it('lets through what keeps this tab on the page, or leaves the edits in place', () => {
    expect(guardedHref(click(anchor('/settings#currency')), HERE)).toBeNull();
    expect(guardedHref(click(anchor('https://elsewhere.example/')), HERE)).toBeNull();
    expect(guardedHref(click(anchor('/users/alice', { target: '_blank' })), HERE)).toBeNull();
    expect(guardedHref(click(anchor('/file.png', { download: '' })), HERE)).toBeNull();
    expect(guardedHref(click(document.body), HERE)).toBeNull();
    expect(guardedHref(click(null), HERE)).toBeNull();
  });

  it('lets through a click that opens a new tab or was already handled', () => {
    const target = anchor('/wishlists/mine');
    expect(guardedHref(click(target, { metaKey: true }), HERE)).toBeNull();
    expect(guardedHref(click(target, { ctrlKey: true }), HERE)).toBeNull();
    expect(guardedHref(click(target, { shiftKey: true }), HERE)).toBeNull();
    expect(guardedHref(click(target, { button: 1 }), HERE)).toBeNull();
    expect(guardedHref(click(target, { defaultPrevented: true }), HERE)).toBeNull();
  });
});
