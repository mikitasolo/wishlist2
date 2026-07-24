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
  role: 'admin' | 'member';
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
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function respond(invite: Invite, action: 'accept' | 'decline') {
    setBusyId(invite._id);
    try {
      const res = await fetch(`/api/invites/${invite._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const result = await res.json();
      if (result.success) {
        setInvites((prev) => prev.filter((i) => i._id !== invite._id));
        // Let the header's invitation dot re-check immediately.
        window.dispatchEvent(new Event('invites-changed'));
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
      setBusyId(null);
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
                      invited you{invite.role === 'admin' ? ' as an admin' : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <button
                    onClick={() => respond(invite, 'decline')}
                    disabled={busyId === invite._id}
                    className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => respond(invite, 'accept')}
                    disabled={busyId === invite._id}
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
