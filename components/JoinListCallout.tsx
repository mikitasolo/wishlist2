'use client';

import { useEffect, useRef, useState } from 'react';
import { signIn } from 'next-auth/react';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import { useToast } from '@/components/ToastProvider';
import { listInviters } from '@/lib/utils/listInviters';

interface JoinListCalloutProps {
  /** The list's owners' usernames, primary owner first (an owner without one isn't in it). */
  ownerUsernames: readonly string[];
  /** How many owners the list has, usernames or not. */
  ownerCount: number;
  /**
   * The signed-in viewer, with their username if they have one yet, or `null`
   * for a signed-out visitor.
   */
  viewer: { username?: string | null } | null;
}

/**
 * The note a list's page shows anyone who isn't on the list (a signed-out
 * visitor, or a signed-in non-member): only people its owners invite can
 * reserve items, and how to get invited. Signed in, it gives them their own
 * username to send the owners, with Copy, since an invite goes by username and
 * the owners rarely know it. Signed out, it offers Sign in, back to this list.
 *
 * It never says which items, or how many, are reserved: the wording is the
 * same whatever the list holds. Owners and members never see it (the page
 * decides), nor does anyone on a list they can't open.
 */
export default function JoinListCallout({
  ownerUsernames,
  ownerCount,
  viewer,
}: JoinListCalloutProps) {
  const inviters = listInviters(ownerUsernames, ownerCount);
  const signedIn = viewer !== null;
  const username = viewer?.username?.trim() || null;

  return (
    <Callout icon="gift" className="mb-6 sm:mb-8">
      <p>
        <span className="font-semibold">Want to reserve a gift?</span> Only people{' '}
        {'handles' in inviters ? (
          inviters.handles.map((handle, i) => (
            <span key={handle}>
              {i > 0 && ' and '}
              <span className="font-semibold">{handle}</span>
            </span>
          ))
        ) : (
          <>{inviters.generic}</>
        )}{' '}
        {inviters.singular ? 'invites' : 'invite'} can reserve items, so nobody buys the same thing
        twice.
        {signedIn && ' Ask them to invite you.'}
      </p>
      {signedIn && username && <ViewerHandle username={username} />}
      {!signedIn && (
        <Button
          size="sm"
          className="mt-3"
          // Auth.js carries it to the sign-in page as its `callbackUrl`, which
          // brings them back to this list once they've signed in.
          onClick={() => signIn(undefined, { redirectTo: window.location.href })}
        >
          Sign in
        </Button>
      )}
    </Callout>
  );
}

/** "Your username is @ivan_petrov", and Copy, which puts that handle on the clipboard. */
function ViewerHandle({ username }: { username: string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  const handle = `@${username}`;

  async function copy() {
    try {
      // With its `@`, the way a handle is shared: the invite form and search
      // both drop it (`usernameQuery`).
      await navigator.clipboard.writeText(handle);
    } catch {
      showToast('Could not copy your username', 'error');
      return;
    }
    setCopied(true);
    showToast('Username copied to clipboard', 'success');
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <p>
        Your username is <span className="font-semibold">{handle}</span>
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon={copied ? 'check' : undefined}
        onClick={copy}
        // Its visible word leads its name, so it can be named by what it says.
        aria-label={copied ? 'Copied your username' : 'Copy your username'}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}
