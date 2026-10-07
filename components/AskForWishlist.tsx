'use client';

import { useEffect, useState } from 'react';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { RequestTimeoutError, withRequestTimeout } from '@/lib/utils/requestTimeout';

/**
 * Ask a friend to make a wishlist (WIS-324): shown on their profile when you
 * can open none of their lists. Reads whether you've already asked (a live ask
 * holds for 30 days), and shows Asked once you have. A failed read offers the
 * button anyway: asking again within the window is answered as already asked,
 * and tells them nothing twice. A refusal that means the page is out of date
 * (no longer friends, or a list you can open now) calls `onStale`, so the
 * profile reads its lists again.
 */
export default function AskForWishlist({
  userId,
  username,
  onStale,
}: {
  userId: string;
  username: string;
  onStale?: () => void;
}) {
  const { showToast } = useToast();
  const [state, setState] = useState<'loading' | 'ask' | 'asking' | 'asked'>('loading');

  useEffect(() => {
    let current = true;
    setState('loading');
    (async () => {
      try {
        const res = await fetch(`/api/users/${userId}/ask`);
        const result = await res.json();
        if (!current) return;
        setState(res.ok && result.success && result.data?.asked ? 'asked' : 'ask');
      } catch {
        if (current) setState('ask');
      }
    })();
    return () => {
      current = false;
    };
  }, [userId]);

  async function ask() {
    setState('asking');
    try {
      const { status, result } = await withRequestTimeout(async (signal) => {
        const res = await fetch(`/api/users/${userId}/ask`, { method: 'POST', signal });
        return { status: res.status, result: await res.json() };
      });
      if (!result.success) {
        setState('ask');
        showToast(result.error || 'Something went wrong', 'error');
        if (status === 403 || status === 409) onStale?.();
        return;
      }
      setState('asked');
      showToast(`Asked @${username}. You’ll hear when they make a list you can open.`, 'success');
    } catch (err) {
      setState('ask');
      showToast(err instanceof RequestTimeoutError ? err.message : 'Something went wrong', 'error');
    }
  }

  if (state === 'loading') return null;
  if (state === 'asked') {
    return (
      <Button variant="secondary" icon="check" disabled>
        Asked
      </Button>
    );
  }
  return (
    <Button icon="list" onClick={ask} disabled={state === 'asking'}>
      {state === 'asking' ? 'Asking…' : 'Ask for a wishlist'}
    </Button>
  );
}
