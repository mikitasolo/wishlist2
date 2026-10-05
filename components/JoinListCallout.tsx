'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import ConfirmDialog from '@/components/ConfirmDialog';
import { listInviters, type ListInviters } from '@/lib/utils/listInviters';
import type { JoinRequestControl } from '@/lib/hooks/useJoinRequest';
import type { LinkJoinControl } from '@/lib/hooks/useLinkJoin';

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
  shareLink?: {
    token: string;
    highlightAsk: boolean;
    /**
     * A **Join** link (WIS-337): Join this list, through a confirmation, in
     * place of Ask to join; signed out, Sign in to join, back with
     * `?then=join`, and then (`confirmOnArrival`) the confirmation opens at
     * once. Joining still takes a click.
     */
    join?: { control: LinkJoinControl; confirmOnArrival: boolean };
  };
}

/** The quiet line under a share link visitor's callout. */
export const KEEP_LINK_TEXT = 'Keep this link to come back to the list.';

/**
 * The note a list's page shows anyone who isn't on the list (a signed-out
 * visitor, or a signed-in non-member): only people its owners invite can
 * reserve items, and how to get invited. Signed in, it offers Ask to join
 * (WIS-275), which asks the owners to invite them: once asked it reads
 * Requested, with Cancel request. Signed out, it offers Sign in, back to this
 * list. On a share link's **Join** link (WIS-337) it offers Join this list
 * instead, through a confirmation (`JoinLinkCallout`).
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
  if (shareLink?.join) {
    return (
      <JoinLinkCallout
        inviters={inviters}
        signedIn={signedIn}
        token={shareLink.token}
        join={shareLink.join}
      />
    );
  }

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

/** "Join @masha’s list?", or "Join this list?" when no one owner can be named. */
export function joinConfirmTitle(inviters: ListInviters): string {
  if ('handles' in inviters && inviters.singular) return `Join ${inviters.handles[0]}’s list?`;
  return 'Join this list?';
}

/** What joining means: they can reserve gifts, and the owners won't see what. */
export function joinConfirmMessage(inviters: ListInviters): string {
  const who =
    'handles' in inviters
      ? inviters.handles.join(' and ')
      : inviters.generic === 'the owner'
        ? 'The owner'
        : 'The owners';
  return `You’ll be able to reserve gifts. ${who} won’t see what you reserve.`;
}

/**
 * The callout on a live **Join** link (WIS-337): signed in, Join this list,
 * which opens the confirmation (Join / Cancel) and never joins by itself;
 * signed out, Sign in to join, back to the link with `?then=join`, where the
 * confirmation opens at once (`confirmOnArrival`, once the viewer is known to
 * be signed in).
 */
function JoinLinkCallout({
  inviters,
  signedIn,
  token,
  join,
}: {
  inviters: ListInviters;
  signedIn: boolean;
  token: string;
  join: { control: LinkJoinControl; confirmOnArrival: boolean };
}) {
  const [confirming, setConfirming] = useState(false);
  // Back from signing in to join: the confirmation, once.
  const [arrivalHandled, setArrivalHandled] = useState(false);
  useEffect(() => {
    if (arrivalHandled || !join.confirmOnArrival || !signedIn) return;
    setArrivalHandled(true);
    setConfirming(true);
  }, [arrivalHandled, join.confirmOnArrival, signedIn]);

  return (
    <Callout icon="gift" className="mb-6 sm:mb-8">
      <p>
        <span className="font-semibold">Want to reserve a gift?</span> Join the list so nobody buys
        the same thing twice.
      </p>
      {signedIn ? (
        <Button
          size="sm"
          icon="user-plus"
          className="mt-3"
          onClick={() => setConfirming(true)}
          disabled={join.control.busy}
        >
          Join this list
        </Button>
      ) : (
        <Button
          size="sm"
          className="mt-3"
          // Back to the link, where the confirmation opens (nothing joins by itself).
          onClick={() => signIn(undefined, { redirectTo: `/l/${token}?then=join` })}
        >
          Sign in to join
        </Button>
      )}
      <p className="mt-3 text-sm text-muted-foreground">{KEEP_LINK_TEXT}</p>
      <ConfirmDialog
        isOpen={confirming && signedIn}
        title={joinConfirmTitle(inviters)}
        message={joinConfirmMessage(inviters)}
        confirmText="Join"
        pendingText="Joining…"
        type="info"
        icon="user-plus"
        onConfirm={async () => {
          await join.control.join();
          // Joined, the page moves on; refused, a toast said why.
          setConfirming(false);
        }}
        onCancel={() => setConfirming(false)}
      />
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
