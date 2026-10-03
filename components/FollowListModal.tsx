'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import BaseModal from './BaseModal';
import LoadError from './LoadError';
import EmptyState from './EmptyState';
import SegmentedControl from './SegmentedControl';
import { Skeleton } from './Skeleton';
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
        <SegmentedControl
          size="sm"
          ariaLabel="Connections"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'followers', label: plural(followerCount, 'follower') },
            { value: 'following', label: plural(followingCount, 'following') },
          ]}
        />
      }
    >
      {/* The rows sit inset from the panel's edge, their hover inside it. */}
      <div ref={listRef} className="-mx-3 -my-3 min-h-[8rem]">
        {loading && !list ? (
          <div>
            {/* Rows shaped like the people to come: a 40px avatar and a name. */}
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
                <Skeleton className="h-4 w-32" />
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
          <EmptyState
            compact
            framed={false}
            tone="muted"
            icon="users"
            title={tab === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
          />
        )}
      </div>
    </BaseModal>
  );
}
