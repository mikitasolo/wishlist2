'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import Panel from '@/components/Panel';
import { useToast } from '@/components/ToastProvider';
import { TOUR_SETTINGS_ID, TOUR_START_PATH } from '@/lib/utils/tourSteps';

/**
 * Take the tour again (WIS-371): resets the guided walkthrough on the account
 * and starts it at once, on Home (`TOUR_START_PATH`), where most of it points.
 */
export default function TourSetting() {
  const router = useRouter();
  const { showToast } = useToast();
  const [starting, setStarting] = useState(false);

  const restart = async () => {
    setStarting(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walkthrough: 'restart' }),
      });
      if (!res.ok) throw new Error('restart failed');
      router.push(TOUR_START_PATH);
    } catch {
      setStarting(false);
      showToast('Couldn’t start the tour. Try again.', 'error');
    }
  };

  return (
    <Panel
      id={TOUR_SETTINGS_ID}
      className="mb-6"
      title="Tour"
      description="A quick look at what you can do here, step by step."
    >
      <Button variant="secondary" icon="sparkles" onClick={restart} disabled={starting}>
        {starting ? 'Starting…' : 'Take the tour again'}
      </Button>
    </Panel>
  );
}
