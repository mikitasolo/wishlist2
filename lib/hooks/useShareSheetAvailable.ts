'use client';

import { useSyncExternalStore } from 'react';
import { canUseShareSheet } from '@/lib/utils/shareLink';

/** Re-read whether to offer the share sheet when the main pointer changes (a tablet's keyboard). */
function subscribeToPointer(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(pointer: coarse)');
  query.addEventListener?.('change', onChange);
  return () => query.removeEventListener?.('change', onChange);
}

/** The server can't know the device: it renders no Share, and the browser adds it once hydrated. */
const noShareSheetOnServer = () => false;

/** Whether to offer the phone's share sheet (`canUseShareSheet`), following the pointer. */
export function useShareSheetAvailable(): boolean {
  return useSyncExternalStore(subscribeToPointer, canUseShareSheet, noShareSheetOnServer);
}
