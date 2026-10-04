'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Avatar from '@/components/Avatar';
import Button from '@/components/Button';
import LoadError from '@/components/LoadError';
import Menu, { type MenuItem } from '@/components/Menu';
import Panel, { PanelRow } from '@/components/Panel';
import { MemberRowSkeleton } from '@/components/Skeleton';
import { iconButtonClassName } from '@/components/buttonStyles';

/**
 * Someone on the list, as `GET /api/wishlists/[id]/members` answers: every
 * owner and every member, in one list.
 */
export interface WishlistPerson {
  /** An owner's *user* id (owners have no membership row), else the membership's id. */
  _id: string;
  user: {
    _id: string;
    username?: string;
    image?: string | null;
  };
  role: 'owner' | 'member';
  createdAt: string;
}

/** A pending invite, as `GET /api/wishlists/[id]/invites` answers. */
export interface PendingInvite {
  _id: string;
  role: 'owner' | 'member';
  username: string | null;
  image: string | null;
}

/**
 * A pending request to join the list, as `GET /api/wishlists/[id]/requests`
 * answers: the requester's public handle and photo, never an email.
 */
export interface JoinRequestView {
  _id: string;
  user: { _id: string; username: string | null; image: string | null };
  createdAt: string;
}

/** The empty Members group's line, on a list whose link opens for people who aren't on it. */
export const NO_MEMBERS_TEXT =
  'No members yet. Members can reserve gifts. Invite people above, or share the link so they can view it.';
/** The same on an invite-only or archived list, whose link opens for nobody who isn't on it. */
export const NO_MEMBERS_INVITE_ONLY_TEXT =
  'No members yet. Members can reserve gifts. Invite people above.';

/** A row's ⋯ trigger: square at an `sm` row action's height. */
const ROW_MENU_TRIGGER = iconButtonClassName({ variant: 'ghost', size: 'sm' });

const handle = (username: string | null | undefined) => `@${username || 'user'}`;

/** The owner invite a member has pending, if any: a promotion they haven't answered yet. */
function ownerInviteFor(invites: readonly PendingInvite[], username: string | undefined) {
  if (!username) return undefined;
  const name = username.toLowerCase();
  return invites.find((i) => i.role === 'owner' && i.username?.toLowerCase() === name);
}

interface WishlistPeopleTabProps {
  /** The invite form, on top. */
  inviteForm: ReactNode;
  people: readonly WishlistPerson[];
  invites: readonly PendingInvite[];
  /** Pending requests to join, oldest first: the Requests group, shown only when there are some. */
  requests?: readonly JoinRequestView[];
  /** Invite: sends the requester a member invite, which they still have to accept. */
  onInviteRequest?: (request: JoinRequestView) => void;
  /** Decline: ends the request without telling them. */
  onDeclineRequest?: (request: JoinRequestView) => void;
  /** The signed-in owner, whose own row says "You" and has no menu. */
  viewerId: string | null;
  /**
   * Whether the list's link opens for anyone who isn't on it (it's public or
   * friends-only, and not archived), so the empty Members group can suggest
   * sharing it.
   */
  linkOpensForOthers: boolean;
  /**
   * How many owners the page counts. With one, there's no owner row to change:
   * a list always keeps one owner.
   */
  ownerCount: number;
  /** The first read of the people hasn't landed yet. */
  loading: boolean;
  /** The first read of the people failed: nothing to show, and Try again. */
  failed: boolean;
  onRetry: () => void;
  /** Whether a row's action is in flight (`useBusyIds`), by user id or, for an invite or a request, its id. */
  busy: (id: string) => boolean;
  /** Make member…: asks before a co-owner is made a member. */
  onDemote: (owner: { userId: string; username: string | null }) => void;
  /** Make owner…: asks before a member is sent an owner invite. */
  onPromote: (member: { userId: string; username: string }) => void;
  /** Remove…: asks before an owner or a member is taken off the list. */
  onRemove: (person: {
    /** What the removal's route takes: an owner's user id, a member's membership id. */
    id: string;
    userId: string;
    username: string | null;
    role: 'owner' | 'member';
  }) => void;
  /** Cancel a pending invite, a member's owner invite included. `busyId` is the row it's on. */
  onCancelInvite: (inviteId: string, busyId: string) => void;
}

/**
 * The People tab of a list's page (owners only): the invite form, then one
 * panel with the list's Owners, Members and the people Invited, one line each:
 * avatar, @name, a caption, and a ⋯ menu of what can be done about them.
 *
 * - Another owner's menu: Make member… and Remove…, each confirmed. A list
 *   always keeps one owner, so with only one there are no other owner rows.
 * - A member's: Make owner… (an invite they have to accept) and Remove…. While
 *   their owner invite is pending, the row says so and offers Cancel invite
 *   instead of Make owner…, and the invite isn't listed again under Invited.
 * - Your own row says "You", with no menu: Leave list… is in the title's ⋯.
 * - An invite: "Invited as co-owner" or "Invited as member", and Cancel.
 * - A request to join (WIS-275), first, under Requests: "Asked to join", with
 *   Invite (a member invite they still have to accept) and Decline (silent).
 *
 * A row's actions are held while one of them is in flight (`busy`). No email
 * is ever shown: people are their public handle.
 */
export default function WishlistPeopleTab({
  inviteForm,
  people,
  invites,
  requests = [],
  onInviteRequest,
  onDeclineRequest,
  viewerId,
  linkOpensForOthers,
  ownerCount,
  loading,
  failed,
  onRetry,
  busy,
  onDemote,
  onPromote,
  onRemove,
  onCancelInvite,
}: WishlistPeopleTabProps) {
  const owners = people.filter((p) => p.role === 'owner');
  const members = people.filter((p) => p.role !== 'owner');
  // A member's own owner invite shows on their row, not again under Invited.
  const memberNames = new Set(
    members.map((m) => m.user.username?.toLowerCase()).filter((u): u is string => !!u)
  );
  const invited = invites.filter(
    (i) => !(i.role === 'owner' && i.username && memberNames.has(i.username.toLowerCase()))
  );

  return (
    <div className="max-w-3xl space-y-6">
      {inviteForm}

      {failed ? (
        <LoadError title="Couldn’t load the people on this list" onRetry={onRetry} />
      ) : (
        <Panel variant="list" aria-label="People on this list">
          {requests.length > 0 && (
            <>
              <GroupHeading>Requests</GroupHeading>
              {requests.map((request) => (
                <PersonRow
                  key={request._id}
                  username={request.user.username}
                  image={request.user.image}
                  fallbackName="Someone"
                  caption="Asked to join"
                  action={
                    <div className="flex shrink-0 items-center gap-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onInviteRequest?.(request)}
                        disabled={busy(request._id)}
                        aria-label={`Invite ${handle(request.user.username)}`}
                      >
                        Invite
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDeclineRequest?.(request)}
                        disabled={busy(request._id)}
                        aria-label={`Decline ${handle(request.user.username)}’s request`}
                      >
                        Decline
                      </Button>
                    </div>
                  }
                />
              ))}
            </>
          )}

          <GroupHeading>Owners</GroupHeading>
          {loading ? (
            <MemberRowSkeleton />
          ) : (
            owners.map((owner) => {
              const userId = String(owner.user._id);
              const username = owner.user.username || null;
              const isYou = userId === viewerId;
              return (
                <PersonRow
                  key={userId}
                  username={owner.user.username}
                  image={owner.user.image}
                  caption={isYou ? 'You' : 'Owner'}
                  action={
                    // Never on yourself, and never on the last owner (a list
                    // always keeps one), which only you can be here.
                    !isYou &&
                    ownerCount > 1 && (
                      <RowMenu
                        username={owner.user.username}
                        items={[
                          {
                            label: 'Make member…',
                            icon: 'user',
                            disabled: busy(userId),
                            onSelect: () => onDemote({ userId, username }),
                          },
                          {
                            label: 'Remove…',
                            icon: 'user-minus',
                            separated: true,
                            disabled: busy(userId),
                            onSelect: () =>
                              onRemove({ id: userId, userId, username, role: 'owner' }),
                          },
                        ]}
                      />
                    )
                  }
                />
              );
            })
          )}

          <GroupHeading>Members</GroupHeading>
          {loading ? (
            <MemberRowSkeleton />
          ) : members.length === 0 ? (
            <PanelRow>
              <p className="text-sm text-muted-foreground">
                {linkOpensForOthers ? NO_MEMBERS_TEXT : NO_MEMBERS_INVITE_ONLY_TEXT}
              </p>
            </PanelRow>
          ) : (
            members.map((member) => {
              // Never you: only an owner sees People, and an owner has no member row.
              const userId = String(member.user._id);
              const ownerInvite = ownerInviteFor(invites, member.user.username);
              const items: MenuItem[] = [
                ownerInvite
                  ? {
                      label: 'Cancel invite',
                      icon: 'undo',
                      disabled: busy(userId),
                      onSelect: () => onCancelInvite(ownerInvite._id, userId),
                    }
                  : {
                      label: 'Make owner…',
                      icon: 'user-plus',
                      disabled: busy(userId),
                      onSelect: () =>
                        onPromote({ userId, username: member.user.username || 'this person' }),
                    },
                {
                  label: 'Remove…',
                  icon: 'user-minus',
                  separated: true,
                  disabled: busy(userId),
                  onSelect: () =>
                    onRemove({
                      id: member._id,
                      userId,
                      username: member.user.username || null,
                      role: 'member',
                    }),
                },
              ];
              return (
                <PersonRow
                  key={member._id}
                  username={member.user.username}
                  image={member.user.image}
                  caption={ownerInvite ? 'Owner invite pending' : 'Member'}
                  action={<RowMenu username={member.user.username} items={items} />}
                />
              );
            })
          )}

          {!loading && invited.length > 0 && (
            <>
              <GroupHeading>Invited</GroupHeading>
              {invited.map((invite) => (
                <PersonRow
                  key={invite._id}
                  username={invite.username}
                  image={invite.image}
                  // An invite whose account has no username yet is still theirs to answer.
                  fallbackName="Invited user"
                  caption={invite.role === 'owner' ? 'Invited as co-owner' : 'Invited as member'}
                  action={
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onCancelInvite(invite._id, invite._id)}
                      disabled={busy(invite._id)}
                      aria-label={`Cancel the invite to ${handle(invite.username)}`}
                    >
                      Cancel
                    </Button>
                  }
                />
              ))}
            </>
          )}
        </Panel>
      )}
    </div>
  );
}

/** A group's label inside the panel: Requests, Owners, Members, Invited. */
function GroupHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="bg-surface-2 px-5 py-2 text-badge uppercase tracking-wide text-muted-foreground sm:px-6">
      {children}
    </h3>
  );
}

/** One person, on one line: avatar, @name over a caption, and the row's action. */
function PersonRow({
  username,
  image,
  fallbackName,
  caption,
  action,
}: {
  username?: string | null;
  image?: string | null;
  /** Shown in place of a handle when there's no username. */
  fallbackName?: string;
  caption: string;
  action?: ReactNode;
}) {
  const name = username ? `@${username}` : (fallbackName ?? handle(username));
  return (
    <PanelRow className="flex items-center gap-3">
      <Avatar name={username || 'user'} src={image} size="md" />
      <div className="min-w-0 flex-1">
        {username ? (
          <Link
            href={`/users/${username}`}
            className="block truncate font-medium text-foreground transition-colors hover:text-accent"
          >
            {name}
          </Link>
        ) : (
          <p className="truncate font-medium text-foreground">{name}</p>
        )}
        <p className="truncate text-xs text-muted-foreground">{caption}</p>
      </div>
      {action}
    </PanelRow>
  );
}

/** A row's ⋯ menu, named for whose row it is. */
function RowMenu({ username, items }: { username?: string | null; items: MenuItem[] }) {
  return (
    <Menu
      label={`Actions for ${handle(username)}`}
      items={items}
      triggerClassName={ROW_MENU_TRIGGER}
    />
  );
}
