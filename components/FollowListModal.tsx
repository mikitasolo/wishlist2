'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import BaseModal from './BaseModal';
import LoadError from './LoadError';
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
  // From the start: the first tab's list is read as soon as the dialog opens,
  // and until then it would show as empty.
  const [loading, setLoading] = useState(true);
  // The tab whose list couldn't be read: said in its place, with Try again
  // (`attempt`), never as "No followers yet". Switching tabs reads it afresh.
  const [failedTab, setFailedTab] = useState<FollowTab | null>(null);
  const [attempt, setAttempt] = useState(0);

  const titleId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cache[tab]) return;
    let cancelled = false;
    setLoading(true);
    setFailedTab(null);
    fetch(`/api/users/${userId}/${tab}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (!res.success || !Array.isArray(res.data)) throw new Error();
        setCache((c) => ({ ...c, [tab]: res.data as FollowUser[] }));
      })
      .catch(() => {
        if (!cancelled) setFailedTab(tab);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, userId, cache, attempt]);

  const list = cache[tab];

  // Focus starts on the close button, stays inside while it's open, and goes
  // back to the count that opened it on close. The tabs are pinned in the
  // header, so they stay in view while a long list scrolls.
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Connections"
      titleId={titleId}
      size="sm"
      closeLabel="Close"
      headerContent={
        <div className="relative flex rounded-xl border border-border bg-surface-2 p-1">
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
      }
    >
      {/* The rows sit inset from the panel's edge, their hover inside it. */}
      <div ref={listRef} className="-mx-3 -my-3 min-h-[8rem]">
        {loading && !list ? (
          <div className="space-y-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <div className="skeleton h-9 w-9 rounded-full" />
                <div className="skeleton h-4 w-32 rounded-md" />
              </div>
            ))}
          </div>
        ) : !list && failedTab === tab ? (
          <LoadError
            compact
            level={3}
            title={tab === 'followers' ? 'Couldn’t load followers' : 'Couldn’t load following'}
            onRetry={() => {
              // Its button goes with it while the list is read again: keep
              // focus in the dialog rather than let it drop to <body>.
              listRef.current?.closest<HTMLElement>('[role="dialog"]')?.focus();
              setAttempt((n) => n + 1);
            }}
          />
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
    </BaseModal>
  );
}
