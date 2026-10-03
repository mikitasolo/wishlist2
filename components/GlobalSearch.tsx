'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icon';
import IconButton from '@/components/IconButton';
import Avatar from '@/components/Avatar';
import { usernameQuery } from '@/lib/utils/searchQuery';

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

interface GlobalSearchProps {
  /**
   * `header` (the default): a search icon that expands into a field.
   * `inline`: an always-open field with the results underneath it, as the
   * signed-out landing page's "find someone's wishlist" entry point.
   */
  variant?: 'header' | 'inline';
}

/**
 * Unified search over usernames and the wishlists you can open, with a live
 * results dropdown: the header's search and the landing page's. The query goes
 * to `/api/search` as typed, which matches people without a leading `@` and
 * list names as typed. (The invite form's username suggestions call
 * `/api/search` on their own.)
 */
export default function GlobalSearch({ variant = 'header' }: GlobalSearchProps) {
  const inline = variant === 'inline';
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [wishlists, setWishlists] = useState<WishlistResult[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape. The header search folds back into its
  // icon; the inline one only hides its results, keeping the field and what
  // was typed in it.
  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      setOpen(false);
      if (!inline) reset();
    };
    const onPointer = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, inline]);

  // Debounced query. A response for a term that's since changed (or been
  // cleared) is dropped, so it can't overwrite newer results.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) {
      setUsers([]);
      setWishlists([]);
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        const result = await res.json();
        if (current && result.success) {
          setUsers(result.data.users || []);
          setWishlists(result.data.wishlists || []);
        }
      } catch {
        /* ignore */
      } finally {
        if (current) setLoading(false);
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [q]);

  function reset() {
    setQ('');
    setUsers([]);
    setWishlists([]);
  }

  function collapse() {
    setOpen(false);
    reset();
  }

  function clear() {
    reset();
    inputRef.current?.focus();
  }

  function go(href: string) {
    collapse();
    router.push(href);
  }

  // Enter opens the person whose username is exactly what was typed, with or
  // without its leading `@`, as the landing page's old find-by-username field did.
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || loading) return;
    const exact = users.find((u) => u.username === usernameQuery(q));
    if (exact) go(`/users/${exact.username}`);
  }

  if (!inline && !open) {
    return (
      <IconButton
        icon="search"
        label="Search"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        variant="chrome"
        size="md"
        shape="pill"
      />
    );
  }

  const term = q.trim();
  const hasResults = users.length > 0 || wishlists.length > 0;
  const dropdownClass = inline
    ? 'animate-fade-in absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-surface py-1.5 text-left shadow-lg'
    : 'animate-fade-in absolute left-4 right-4 top-[3.5rem] overflow-hidden rounded-2xl border border-border bg-surface py-1.5 shadow-lg sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80';

  return (
    <div
      ref={containerRef}
      className={
        inline
          ? 'relative w-full'
          : 'fixed inset-x-0 top-0 z-50 flex h-14 items-center gap-2 border-b border-border bg-surface px-4 sm:relative sm:inset-auto sm:top-auto sm:z-auto sm:h-auto sm:border-0 sm:bg-transparent sm:px-0'
      }
    >
      <div
        className={
          inline
            ? 'flex w-full items-center gap-2 rounded-full border border-border-strong bg-surface pl-4 pr-1.5 shadow-xs field-focus'
            : 'flex min-w-0 flex-1 items-center gap-2 rounded-full border border-border-strong bg-surface pl-3.5 pr-1.5 shadow-xs field-focus sm:w-72 sm:flex-none'
        }
      >
        <Icon name="search" size={17} className="flex-shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search people & wishlists…"
          aria-label="Search people and wishlists"
          className={`${inline ? 'h-11' : 'h-10'} min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-hidden`}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        {inline ? (
          q && (
            <IconButton
              type="button"
              icon="close"
              label="Clear search"
              onClick={clear}
              shape="pill"
            />
          )
        ) : (
          <IconButton icon="close" label="Close search" onClick={collapse} shape="pill" />
        )}
      </div>

      {open && term.length > 0 && term.length < 3 && (
        <div className={dropdownClass}>
          <p className="px-4 py-3 text-sm text-muted-foreground">Type at least 3 characters…</p>
        </div>
      )}

      {open && term.length >= 3 && (
        <div className={dropdownClass}>
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
                  <span className="truncate text-sm font-medium text-foreground">
                    @{u.username}
                  </span>
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
                    <span className="block truncate text-sm font-medium text-foreground">
                      {w.name}
                    </span>
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
