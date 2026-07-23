'use client';

import { useEffect } from 'react';

/**
 * Locks scrolling on the page body while any modal/dialog is open.
 *
 * Uses a shared reference count so that stacked overlays (e.g. a confirmation
 * dialog on top of a modal) don't prematurely restore scrolling when the
 * top-most one closes — the body stays locked until the last one unmounts.
 */
let lockCount = 0;
let savedScrollY = 0;

function applyLock() {
  if (lockCount === 0) {
    savedScrollY = window.scrollY;
    const { body } = document;
    body.style.position = 'fixed';
    body.style.top = `-${savedScrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function releaseLock() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    const { body } = document;
    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.right = '';
    body.style.width = '';
    body.style.overflow = '';
    document.documentElement.style.overflow = '';
    window.scrollTo(0, savedScrollY);
  }
}

export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    applyLock();
    return releaseLock;
  }, [active]);
}
