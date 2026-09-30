'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import Avatar from '@/components/Avatar';
import Icon from '@/components/Icon';
import { useToast } from '@/components/ToastProvider';

interface Invite {
  _id: string;
  role: 'owner' | 'member';
  wishlistId: string;
  wishlistName: string;
  wishlistSlug: string | null;
  invitedByUsername: string | null;
  invitedByImage: string | null;
}

export default function InvitesPage() {
  const { status } = useSession();
  const router = useRouter();
  const { showToast } = useToast();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  // Invites whose answer is still in flight. Tracked per invite, not as one id
  // for the page: answering another card must not re-enable this one's
  // buttons, and that answer settling first must not unlock this one while its
  // own request is still pending.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/');
  }, [status, router]);

  const load = useCallback(() => {
    fetch('/api/users/me/invites', { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setInvites(res.data);
        else showToast('Failed to load invites', 'error');
      })
      .catch(() => showToast('Failed to load invites', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useEffect(() => {
    if (status === 'authenticated') load();
  }, [status, load]);

  // Take an invite off the page and let the header's invitation dot re-check
  // immediately.
  function dropInvite(inviteId: string) {
    setInvites((prev) => prev.filter((i) => i._id !== inviteId));
    window.dispatchEvent(new Event('invites-changed'));
  }

  // A functional update, so answers settling in any order each touch only
  // their own entry and never write back a stale copy of the set.
  function setBusy(inviteId: string, busy: boolean) {
    setBusyIds((prev) => {
      if (prev.has(inviteId) === busy) return prev;
      const next = new Set(prev);
      if (busy) next.add(inviteId);
      else next.delete(inviteId);
      return next;
    });
  }

  async function respond(invite: Invite, action: 'accept' | 'decline') {
    setBusy(invite._id, true);
    try {
      const res = await fetch(`/api/invites/${invite._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      // Parsed first, so a 404 that isn't the route's own JSON answer (an HTML
      // page from the platform) lands in the catch below and keeps the card.
      const result = await res.json();
      // The invite went away while this page was open: an owner cancelled it,
      // its list was deleted, we left or lost our role there, or another tab
      // already answered it. Every retry would 404 the same way, so drop the
      // card. Any other failure keeps it, so the user can retry.
      if (res.status === 404) {
        dropInvite(invite._id);
        showToast('This invitation is no longer available', 'info');
        return;
      }
      if (result.success) {
        dropInvite(invite._id);
        if (action === 'accept') {
          showToast(`Joined “${invite.wishlistName}”`, 'success');
          router.push(`/wishlists/${result.data.wishlistSlug ?? result.data.wishlistId}`);
        } else {
          showToast('Invitation declined', 'info');
        }
      } else {
        showToast(result.error || 'Something went wrong', 'error');
      }
    } catch {
      showToast('Something went wrong', 'error');
    } finally {
      setBusy(invite._id, false);
    }
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Invitations</h1>
        <p className="mt-1 text-muted-foreground">Wishlists people have invited you to join.</p>

        {loading ? (
          <div className="mt-8 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton h-24 rounded-2xl" />
            ))}
          </div>
        ) : invites.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-3xl border border-dashed border-border-strong py-16 text-center sm:py-20">
            <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <Icon name="inbox" size={28} />
            </span>
            <h3 className="text-lg font-semibold text-foreground sm:text-xl">
              No pending invitations
            </h3>
            <p className="mx-auto mt-1.5 max-w-sm px-4 text-sm text-muted-foreground">
              When someone invites you to a wishlist, it&apos;ll show up here.
            </p>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {invites.map((invite) => (
              <li
                key={invite._id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={invite.invitedByUsername || 'user'}
                    src={invite.invitedByImage}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-foreground">{invite.wishlistName}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {invite.invitedByUsername ? `@${invite.invitedByUsername}` : 'Someone'}{' '}
                      invited you
                      {invite.role === 'owner' ? ' as a co-owner' : ''}
                    </p>
                    {/* Accepting co-ownership is destructive on the gifting side —
                        say so before they tap Accept, not after. */}
                    {invite.role === 'owner' && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        You’ll get full control and the list will show on your profile. Owners never
                        see booking status, so anything you’ve booked here will be released.
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() => respond(invite, 'decline')}
                    disabled={busyIds.has(invite._id)}
                    className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => respond(invite, 'accept')}
                    disabled={busyIds.has(invite._id)}
                    className="inline-flex h-9 items-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)] transition-colors hover:bg-primary-500 disabled:opacity-50"
                  >
                    Accept
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
