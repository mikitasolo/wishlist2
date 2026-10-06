'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { DISCREET_STORAGE_KEY, parseDiscreet } from '@/lib/utils/discreet';

// One shared value for every component on the page (the account menu's
// switch, the header's indicator, the lists and Reserved), kept in
// localStorage like the theme. Storage can throw or be absent (private
// windows), so the value then lives for the page only.
let current = false;
let loaded = false;
const listeners = new Set<() => void>();

function read(): boolean {
  if (!loaded) {
    loaded = true;
    try {
      current = parseDiscreet(localStorage.getItem(DISCREET_STORAGE_KEY));
    } catch {
      /* off */
    }
  }
  return current;
}

function emit() {
  listeners.forEach((l) => l());
}

// One storage listener for every subscriber (a card each), attached with the
// first and removed with the last. Another tab turned it on or off.
function onStorage(e: StorageEvent) {
  if (e.key !== DISCREET_STORAGE_KEY && e.key !== null) return;
  try {
    current = parseDiscreet(localStorage.getItem(DISCREET_STORAGE_KEY));
  } catch {
    return;
  }
  emit();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Turns discreet mode on or off for this device. */
export function setDiscreetMode(on: boolean) {
  read();
  current = on;
  try {
    if (on) localStorage.setItem(DISCREET_STORAGE_KEY, '1');
    else localStorage.removeItem(DISCREET_STORAGE_KEY);
  } catch {
    /* kept for this page */
  }
  emit();
}

/** Test seam: forget what was read, so the next read goes to storage. */
export function resetDiscreetModeForTests() {
  loaded = false;
  current = false;
  emit();
}

/**
 * Whether discreet mode is on, and the way to change it. Off on the server and
 * in the render that hydrates it, then what this device chose.
 */
export function useDiscreetMode(): { discreet: boolean; setDiscreet: (on: boolean) => void } {
  const discreet = useSyncExternalStore(subscribe, read, () => false);
  const setDiscreet = useCallback((on: boolean) => setDiscreetMode(on), []);
  return { discreet, setDiscreet };
}
