'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import BaseModal from './BaseModal';
import LoadError from './LoadError';
import SearchField from './SearchField';
import EmptyState from './EmptyState';
import SegmentedControl from './SegmentedControl';
import { Skeleton } from './Skeleton';
import { plural } from '@/lib/utils/plural';
import { usernameQuery } from '@/lib/utils/searchQuery';

export type FollowTab = 'followers' | 'following';

/** From this many people a tab offers a search; a handful needs none. */
export const FOLLOW_SEARCH_MIN = 6;

interface FollowUser {
  _id: string;
  username: string;
  image?: string | null;
}

interface FollowListModalProps {
  userId: string;
  initialTab: FollowTab;
  /**
   * The counts the tabs are labelled with ("3 followers"), from wherever the
   * opener read them. Left out (Activity, which hasn't read them), the tabs
   * are just "Followers" and "Following".
   */
  followerCount?: number;
  followingCount?: number;
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
  const [queries, setQueries] = useState<Record<FollowTab, string>>({
    followers: '',
    following: '',
  });

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

  // Both lists are read whole (no paging), so the search filters the rows
  // already here, on the username each row shows: the answer carries no
  // name or email to match. Each tab keeps its own query. Whether a tab has
  // the field goes by the count it's labelled with when there is one, so the
  // header doesn't jump as the list loads; without counts (Activity), by the
  // list once read. A list that failed to load has nothing to search.
  const size = (tab === 'followers' ? followerCount : followingCount) ?? list?.length ?? 0;
  const searchable = size >= FOLLOW_SEARCH_MIN && !(failedTab === tab && !list);
  const query = queries[tab];
  const needle = searchable ? usernameQuery(query) : '';
  const shown = useMemo(
    () => (list && needle ? list.filter((u) => u.username.toLowerCase().includes(needle)) : list),
    [list, needle]
  );
  const setQuery = (q: string) => setQueries((qs) => ({ ...qs, [tab]: q }));

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
        <div className="space-y-3">
          <SegmentedControl
            size="sm"
            ariaLabel="Connections"
            value={tab}
            onChange={setTab}
            options={[
              {
                value: 'followers',
                label:
                  followerCount === undefined ? 'Followers' : plural(followerCount, 'follower'),
              },
              {
                value: 'following',
                label:
                  followingCount === undefined ? 'Following' : plural(followingCount, 'following'),
              },
            ]}
          />
          {searchable && (
            <SearchField
              size="sm"
              aria-label={tab === 'followers' ? 'Search followers' : 'Search following'}
              placeholder={tab === 'followers' ? 'Search followers' : 'Search following'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery('')}
            />
          )}
        </div>
      }
    >
      {/* The rows sit inset from the panel's edge, their hover inside it. */}
      <div ref={listRef} className="-mx-3 -my-3 min-h-[8rem]">
        {/* Focus stays in the field while the rows change: say how many are left. */}
        <p role="status" className="sr-only">
          {needle && shown ? plural(shown.length, 'match', 'matches') : ''}
        </p>
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
        ) : list && list.length > 0 && shown && shown.length === 0 ? (
          <EmptyState
            compact
            framed={false}
            tone="muted"
            icon="search"
            level={3}
            title="No one matches"
          />
        ) : shown && shown.length > 0 ? (
          shown.map((u) => (
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
