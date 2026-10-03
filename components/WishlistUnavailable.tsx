'use client';

import Link from 'next/link';
import { signIn } from 'next-auth/react';
import Button from '@/components/Button';
import StatePanel from '@/components/StatePanel';
import { buttonClassName } from '@/components/buttonStyles';

/**
 * What the wishlist page shows, at the list's own URL, when the list can't be
 * shown to this viewer: it doesn't exist, or it's private, friends-only or
 * archived and they aren't let in. One state for all of them, worded the same,
 * so the page never confirms that a hidden list exists. Only whether the viewer
 * is signed in changes it, never why the list was refused.
 *
 * Signed out, it offers to sign in and come back here, since a list shared with
 * them may well open once they have.
 */
export default function WishlistUnavailable({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return (
      <StatePanel
        icon="link-off"
        level={1}
        title="This wishlist isn’t available to you"
        body="It may have been deleted, or it’s only visible to people it’s shared with."
        actions={
          <Link href="/" className={buttonClassName()}>
            Back to your wishlists
          </Link>
        }
      />
    );
  }
  return (
    <StatePanel
      icon="link-off"
      level={1}
      title="This wishlist isn’t available"
      body="If someone shared it with you, sign in to see it."
      actions={
        <>
          {/* Auth.js carries it to the sign-in page as its `callbackUrl`. */}
          <Button onClick={() => signIn(undefined, { redirectTo: window.location.href })}>
            Sign in
          </Button>
          <Link href="/" className={buttonClassName({ variant: 'secondary' })}>
            Go home
          </Link>
        </>
      }
    />
  );
}
