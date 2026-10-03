'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import Icon from './Icon';
import Avatar from './Avatar';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { plural } from '@/lib/utils/plural';

export type FollowTab = 'followers' | 'following';

interface FollowUser {
  _id: string;
  username: string;
  image?: string | null;
}

interface FollowListModalProps {
  userId: string;
  initialTab: FollowTab;
  followerCount: number;
  followingCount: number;
  onClose: () => void;
}

export default function FollowListModal({
  userId,
  initialTab,
  followerCount,
  followingCount,
  onClose,
}: FollowListModalProps) {
  const [tab, setTab] = useState<FollowTab>(initialTab);
  // Cache each tab's list so switching back is instant.
  const [cache, setCache] = useState<Partial<Record<FollowTab, FollowUser[]>>>({});
  const [loading, setLoading] = useState(false);

  useBodyScrollLock(true);

  // Focus starts on the close button, stays inside while it's open, and goes
  // back to the count that opened it on close.
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(true, dialogRef);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (cache[tab]) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/users/${userId}/${tab}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.success) setCache((c) => ({ ...c, [tab]: res.data as FollowUser[] }));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, userId, cache]);

  const list = cache[tab];

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="animate-dialog-in flex max-h-[80vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Header + tabs */}
        <div className="flex items-center justify-between px-4 pt-3">
          <h2 id={titleId} className="text-base font-semibold text-foreground">
            Connections
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="relative mx-4 mt-3 mb-1 flex rounded-xl border border-border bg-surface-2 p-1">
          <span
            aria-hidden
            className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
            style={{
              width: 'calc((100% - 0.5rem) / 2)',
              left: `calc(${tab === 'followers' ? 0 : 1} * ((100% - 0.5rem) / 2) + 0.25rem)`,
            }}
          />
          {(['followers', 'following'] as FollowTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative z-10 flex-1 rounded-lg py-1.5 text-sm font-semibold transition-colors ${
                tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'followers'
                ? plural(followerCount, 'follower')
                : plural(followingCount, 'following')}
            </button>
          ))}
        </div>

        {/* List */}
        <div className="min-h-[8rem] flex-1 overflow-y-auto p-2">
          {loading && !list ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <div className="skeleton h-9 w-9 rounded-full" />
                  <div className="skeleton h-4 w-32 rounded-md" />
                </div>
              ))}
            </div>
          ) : list && list.length > 0 ? (
            list.map((u) => (
              <Link
                key={u._id}
                href={`/users/${u.username}`}
                onClick={onClose}
                className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted"
              >
                <Avatar name={u.username} src={u.image} size="md" />
                <span className="truncate text-sm font-medium text-foreground">@{u.username}</span>
              </Link>
            ))
          ) : (
            <div className="flex h-32 flex-col items-center justify-center text-center">
              <p className="text-sm text-muted-foreground">
                {tab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
