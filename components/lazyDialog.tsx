'use client';

import dynamic from 'next/dynamic';
import { useEffect, type ComponentType } from 'react';
import { useToast } from '@/components/ToastProvider';

/** Toast when a lazily loaded part of the app can't be fetched. */
export const CHUNK_FAILED_MESSAGE = 'This part of the app was updated. Reload to continue.';

/**
 * Loads an import, once more if it fails (a network blip), so only a chunk
 * that is really gone (a tab left open across a deploy: its old chunk URLs
 * 404) gets through to `ChunkFailed`.
 */
export async function importWithRetry<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch {
    return load();
  }
}

/** Stands in for a dialog whose code couldn't load: one toast, and the dialog told to close. */
function ChunkFailed({ onClose }: { onClose?: () => void }) {
  const { showToast } = useToast();
  useEffect(() => {
    showToast(CHUNK_FAILED_MESSAGE, 'error', {
      action: { label: 'Reload', onClick: () => window.location.reload() },
      duration: 15000,
    });
    // Whoever opened it hears it's closed, so its flag drops (the failure is
    // remembered until a reload, which is what the toast offers).
    onClose?.();
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function closer(props: object): (() => void) | undefined {
  const { onClose, onCancel } = props as { onClose?: () => void; onCancel?: () => void };
  return onClose ?? onCancel;
}

/**
 * `next/dynamic` for a dialog, or any part loaded on first need (WIS-438),
 * with one failure path: the import is retried once, and if it still fails the
 * page keeps working and shows a toast with a Reload action, instead of
 * throwing to the error boundary. `quiet` shows nothing instead of the toast,
 * for a part nobody clicked (the walkthrough).
 */
export function lazyDialog<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  options: { quiet?: boolean } = {}
): ComponentType<P> {
  const Failed: ComponentType<P> = (props) =>
    options.quiet ? null : <ChunkFailed onClose={closer(props)} />;
  return dynamic(() => importWithRetry(load).catch(() => ({ default: Failed })));
}
