'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icon';
import Avatar from '@/components/Avatar';

interface UserResult {
  username: string;
  image?: string | null;
}
interface WishlistResult {
  _id: string;
  name: string;
  slug: string | null;
  ownerUsername: string | null;
}

/**
 * Unified search: a search icon that expands into a field, querying both
 * usernames and public wishlist names with a live results dropdown.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [wishlists, setWishlists] = useState<WishlistResult[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) collapse();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') collapse();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Debounced query
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setUsers([]);
      setWishlists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        const result = await res.json();
        if (result.success) {
          setUsers(result.data.users || []);
          setWishlists(result.data.wishlists || []);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  function collapse() {
    setOpen(false);
    setQ('');
    setUsers([]);
    setWishlists([]);
  }

  function go(href: string) {
    collapse();
    router.push(href);
  }

  if (!open) {
    return (
      <button
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        aria-label="Search"
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-muted-foreground shadow-xs transition-colors hover:bg-surface-hover hover:text-foreground"
      >
        <Icon name="search" size={18} />
      </button>
    );
  }

  const term = q.trim();
  const hasResults = users.length > 0 || wishlists.length > 0;

  return (
    <div
      ref={containerRef}
      className="fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b border-border bg-surface px-4 sm:relative sm:inset-auto sm:top-auto sm:z-auto sm:h-auto sm:border-0 sm:bg-transparent sm:px-0"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border-strong bg-surface pl-3.5 pr-1.5 shadow-xs sm:w-72 sm:flex-none">
        <Icon name="search" size={17} className="flex-shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people & wishlists…"
          className="h-10 min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          onClick={collapse}
          aria-label="Close search"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {term.length > 0 && term.length < 3 && (
        <div className="animate-fade-in absolute left-4 right-4 top-[3.5rem] overflow-hidden rounded-2xl border border-border bg-surface py-1.5 shadow-lg sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
          <p className="px-4 py-3 text-sm text-muted-foreground">Type at least 3 characters…</p>
        </div>
      )}

      {term.length >= 3 && (
        <div className="animate-fade-in absolute left-4 right-4 top-[3.5rem] overflow-hidden rounded-2xl border border-border bg-surface py-1.5 shadow-lg sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80">
          {loading && !hasResults && (
            <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
          )}
          {!loading && !hasResults && (
            <p className="px-4 py-3 text-sm text-muted-foreground">No matches for “{term}”.</p>
          )}

          {users.length > 0 && (
            <div>
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                People
              </p>
              {users.map((u) => (
                <button
                  key={u.username}
                  onClick={() => go(`/users/${u.username}`)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted"
                >
                  <Avatar name={u.username} src={u.image} size="sm" />
                  <span className="truncate text-sm font-medium text-foreground">@{u.username}</span>
                </button>
              ))}
            </div>
          )}

          {wishlists.length > 0 && (
            <div>
              <p className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Wishlists
              </p>
              {wishlists.map((w) => (
                <button
                  key={w._id}
                  onClick={() => go(`/wishlists/${w.slug ?? w._id}`)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500/12 text-accent dark:text-primary-300">
                    <Icon name="gift" size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{w.name}</span>
                    {w.ownerUsername && (
                      <span className="block truncate text-xs text-muted-foreground">
                        @{w.ownerUsername}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
