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
  /**
   * Set on a share link's page (WIS-335): signed out, the button reads Sign in
   * to ask to join and comes back to the link with `?then=ask`; back from it,
   * `highlightAsk` highlights Ask to join (nothing is sent until it's clicked).
   * It also says to keep the link, the only way back for a visitor.
   */
  shareLink?: { token: string; highlightAsk: boolean };
}

/** The quiet line under a share link visitor's callout. */
export const KEEP_LINK_TEXT = 'Keep this link to come back to the list.';

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
  shareLink,
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
      {signedIn && joinRequest && (
        <AskToJoin request={joinRequest} highlight={!!shareLink?.highlightAsk} />
      )}
      {!signedIn && (
        <Button
          size="sm"
          className="mt-3"
          // Auth.js carries it to the sign-in page as its `callbackUrl`, which
          // brings them back to this list once they've signed in: on a share
          // link, to the link (the list's own URL may not open for them).
          onClick={() =>
            signIn(undefined, {
              redirectTo: shareLink ? `/l/${shareLink.token}?then=ask` : window.location.href,
            })
          }
        >
          {shareLink ? 'Sign in to ask to join' : 'Sign in'}
        </Button>
      )}
      {shareLink && <p className="mt-3 text-sm text-muted-foreground">{KEEP_LINK_TEXT}</p>}
    </Callout>
  );
}

/** Ask to join, or, once asked, Requested and Cancel request. Nothing until the read lands. */
function AskToJoin({ request, highlight }: { request: JoinRequestControl; highlight: boolean }) {
  if (request.state === 'unknown') return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      {request.state === 'none' ? (
        <Button
          size="sm"
          icon="user-plus"
          onClick={request.ask}
          disabled={request.busy}
          // Back from signing in to ask: the button they came for, ringed.
          className={highlight ? 'ring-2 ring-ring ring-offset-2 ring-offset-background' : ''}
        >
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
