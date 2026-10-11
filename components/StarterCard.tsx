'use client';

import type { ReactNode } from 'react';
import Button from '@/components/Button';
import OwnHandle from '@/components/OwnHandle';
import Panel from '@/components/Panel';

/**
 * The number centres on the step's first line (a 28px line box, the circle's
 * height), or on the whole row when the step holds a taller control.
 */
function Step({
  n,
  children,
  hasControl = false,
}: {
  n: number;
  children: ReactNode;
  hasControl?: boolean;
}) {
  return (
    <li className={`flex gap-3 ${hasControl ? 'items-center' : 'items-start'}`}>
      <span
        aria-hidden="true"
        className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-500/12 text-sm font-semibold text-accent"
      >
        {n}
      </span>
      <div className="flex min-h-7 min-w-0 items-center text-body text-foreground">{children}</div>
    </li>
  );
}

/**
 * Home with no lists yet: three steps, the first one's button opening the
 * create dialog. Step 3 points at the list's Share button. Below the steps, a
 * quieter line gives the user's own handle to copy (how friends invite you to
 * their lists); with no username yet it's left out.
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
        <Step n={1} hasControl>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>Create a list</span>
            <Button size="sm" icon="plus" onClick={onCreate}>
              Create wishlist
            </Button>
          </div>
        </Step>
        <Step n={2}>Add a few things you’d love to get</Step>
        <Step n={3}>Share it with friends: send its link from the list’s Share button</Step>
      </ol>
      {username && (
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border pt-4 text-sm text-muted-foreground">
          <span>Friends invite you to their lists by username:</span>
          <OwnHandle username={username} />
        </div>
      )}
    </Panel>
  );
}
