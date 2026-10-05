'use client';

import { useState } from 'react';
import Link from 'next/link';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import EmptyState from '@/components/EmptyState';
import { buttonClassName } from '@/components/buttonStyles';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';

type Phase = 'idle' | 'pending' | 'done' | 'error';

/**
 * The `/unsubscribe` page's one button (WIS-321): POSTs the signed link's query
 * to `/api/unsubscribe`, which turns that one email off. A button rather than
 * the page load doing it, so a mail scanner opening the link changes nothing.
 * Nothing here names the account: only the event the link is for.
 */
export default function UnsubscribeConfirm({ query, label }: { query: string; label: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const topic = label.toLowerCase();

  async function unsubscribe() {
    setPhase('pending');
    try {
      const res = await withRequestTimeout((signal) =>
        fetch(`/api/unsubscribe?${query}`, { method: 'POST', signal })
      );
      setPhase(res.ok ? 'done' : 'error');
    } catch {
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <EmptyState
        framed={false}
        icon="check-circle"
        level={1}
        title="You’re unsubscribed"
        body={`You won’t get emails about ${topic} any more. You can turn them back on in Settings.`}
        actions={
          <Link
            href="/settings#notifications"
            className={buttonClassName({ variant: 'secondary' })}
          >
            Notification settings
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      framed={false}
      icon="mail"
      level={1}
      title={`Stop emails about ${topic}?`}
      body="Only these emails stop. Your other emails, and what you see in Activity, stay as they are."
      actions={
        <Button onClick={unsubscribe} disabled={phase === 'pending'}>
          {phase === 'pending' ? 'Unsubscribing…' : 'Unsubscribe'}
        </Button>
      }
    >
      {phase === 'error' && (
        <Callout tone="danger" className="mx-auto max-w-sm text-left">
          Couldn’t unsubscribe. Try again.
        </Callout>
      )}
    </EmptyState>
  );
}
