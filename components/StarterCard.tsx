'use client';

import type { ReactNode } from 'react';
import Button from '@/components/Button';
import OwnHandle from '@/components/OwnHandle';
import Panel from '@/components/Panel';

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-500/12 text-sm font-semibold text-accent"
      >
        {n}
      </span>
      <div className="min-w-0 pt-0.5 text-body text-foreground">{children}</div>
    </li>
  );
}

/**
 * Home with no lists yet: three steps, the first one's button opening the
 * create dialog. Step 3 says how friends find you (by username) with the
 * user's own handle to copy; with no username yet it's just "Share it".
 */
export default function StarterCard({
  username,
  onCreate,
}: {
  username: string | null;
  onCreate: () => void;
}) {
  return (
    <Panel title="Get started" description="Three steps to your first shared wishlist.">
      <ol className="mt-5 space-y-4">
        <Step n={1}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Create a list</span>
            <Button size="sm" icon="plus" onClick={onCreate}>
              Create wishlist
            </Button>
          </div>
        </Step>
        <Step n={2}>Add a few things you’d love to get</Step>
        <Step n={3}>
          {username ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              <span>Share it. Friends invite you by username:</span>
              <OwnHandle username={username} />
            </div>
          ) : (
            'Share it'
          )}
        </Step>
      </ol>
    </Panel>
  );
}
