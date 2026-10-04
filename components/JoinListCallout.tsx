'use client';

import { signIn } from 'next-auth/react';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import { listInviters } from '@/lib/utils/listInviters';
import type { JoinRequestControl } from '@/lib/hooks/useJoinRequest';

interface JoinListCalloutProps {
  /** The list's owners' usernames, primary owner first (an owner without one isn't in it). */
  ownerUsernames: readonly string[];
  /** How many owners the list has, usernames or not. */
  ownerCount: number;
  /** Whether the viewer is signed in (a signed-out visitor is offered Sign in instead). */
  signedIn: boolean;
  /**
   * A signed-in viewer's request to join (`useJoinRequest`): Ask to join, or
   * Requested with Cancel request.
   */
  joinRequest?: JoinRequestControl;
}

/**
 * The note a list's page shows anyone who isn't on the list (a signed-out
 * visitor, or a signed-in non-member): only people its owners invite can
 * reserve items, and how to get invited. Signed in, it offers Ask to join
 * (WIS-275), which asks the owners to invite them: once asked it reads
 * Requested, with Cancel request. Signed out, it offers Sign in, back to this
 * list.
 *
 * It never says which items, or how many, are reserved: the wording is the
 * same whatever the list holds. Owners and members never see it (the page
 * decides), nor does anyone on a list they can't open.
 */
export default function JoinListCallout({
  ownerUsernames,
  ownerCount,
  signedIn,
  joinRequest,
}: JoinListCalloutProps) {
  const inviters = listInviters(ownerUsernames, ownerCount);

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
        {signedIn &&
          (joinRequest?.state === 'requested'
            ? ' You’ve asked them to invite you.'
            : ' Ask to join, and they can invite you.')}
      </p>
      {signedIn && joinRequest && <AskToJoin request={joinRequest} />}
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

/** Ask to join, or, once asked, Requested and Cancel request. Nothing until the read lands. */
function AskToJoin({ request }: { request: JoinRequestControl }) {
  if (request.state === 'unknown') return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {request.state === 'none' ? (
        <Button size="sm" icon="user-plus" onClick={request.ask} disabled={request.busy}>
          Ask to join
        </Button>
      ) : (
        <>
          <Button variant="secondary" size="sm" icon="check" disabled>
            Requested
          </Button>
          <Button variant="ghost" size="sm" onClick={request.cancel} disabled={request.busy}>
            Cancel request
          </Button>
        </>
      )}
    </div>
  );
}
