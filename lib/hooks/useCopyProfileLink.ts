'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ToastProvider';

const COPIED_NOTE_MS = 2000;

/**
 * Copy a user's profile link (`/users/<username>`, on this site's origin) to the
 * clipboard, with the toast and a `copied` flag that holds for a moment. Only
 * ever given the signed-in user's own handle.
 */
export function useCopyProfileLink(username: string) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(
        new URL(`/users/${username}`, window.location.origin).href
      );
    } catch {
      showToast('Could not copy your profile link', 'error');
      return;
    }
    setCopied(true);
    showToast('Profile link copied to clipboard', 'success');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_NOTE_MS);
  }

  return { copied, copy };
}
