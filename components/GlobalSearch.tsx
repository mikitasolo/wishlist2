'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Icon from '@/components/Icon';
import IconButton from '@/components/IconButton';
import Avatar from '@/components/Avatar';
import {
  POPOVER_GROUP_LABEL,
  POPOVER_NOTE,
  POPOVER_OPTION_ROW,
  POPOVER_SURFACE,
} from '@/components/popoverStyles';
import { usernameQuery } from '@/lib/utils/searchQuery';
import {
  RELATION_LABEL,
  type ListRelation,
  type PersonRelation,
} from '@/lib/utils/searchRelations';

interface UserResult {
  username: string;
  image?: string | null;
  /** The searcher's own relation to them; absent on "People you follow". */
  relation?: PersonRelation | null;
}
interface WishlistResult {
  _id: string;
  name: string;
  slug: string | null;
  ownerUsername: string | null;
  relation?: ListRelation | null;
}

/** One row of the results, in the order the arrow keys move through them. */
type Option =
  | { kind: 'person'; key: string; href: string; user: UserResult }
  | { kind: 'list'; key: string; href: string; list: WishlistResult };

/** How many of the people you follow the open, empty search offers. */
export const FOLLOWING_SUGGESTIONS = 5;

interface GlobalSearchProps {
  /**
   * `header` (the default): a search icon that expands into a field.
   * `inline`: an always-open field with the results underneath it, as the
   * signed-out landing page's "find someone's wishlist" entry point.
   */
  variant?: 'header' | 'inline';
  /** Told whenever the header search opens into its field or folds back (the header makes room). */
  onOpenChange?: (open: boolean) => void;
}

const personOption = (user: UserResult): Option => ({
  kind: 'person',
  key: `u:${user.username}`,
  href: `/users/${user.username}`,
  user,
});

/**
 * Unified search over usernames and the wishlists you can open, with a live
 * results dropdown: the header's search and the landing page's. The query goes
 * to `/api/search` as typed, which matches people without a leading `@` and
 * list names as typed. (The invite form's username suggestions call
 * `/api/search` on their own.) Open and empty, it offers the people you follow.
 *
 * The field is a WAI-ARIA combobox with a listbox popup, on the invite form's
 * keyboard model: focus stays in the field, ↓ and ↑ move the active option
 * (`aria-activedescendant`), and Enter opens it. A search's first result is
 * active as soon as it lands. Escape closes the results and stops at the
 * field; with them closed, the header's search folds back into its icon.
 *
 * A row's label is only ever about the searcher's own relation to it (Friend,
 * Follows you, Your list, Member), as the API sends it.
 */
export default function GlobalSearch({ variant = 'header', onOpenChange }: GlobalSearchProps) {
  const inline = variant === 'inline';
  const router = useRouter();
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  // The header's field (the inline one is always there).
  const [expanded, setExpanded] = useState(false);
  // The results popover.
  const [open, setOpen] = useState(false);
  // Before paint, so the header makes room in the same frame the field opens.
  useLayoutEffect(() => {
    onOpenChange?.(inline ? open : expanded);
  }, [inline, open, expanded, onOpenChange]);
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<UserResult[]>([]);
  const [wishlists, setWishlists] = useState<WishlistResult[]>([]);
  const [loading, setLoading] = useState(false);
  // The people you follow, for the open, empty search: keyed on whose they are,
  // so another account signing in never sees the previous one's.
  const [following, setFollowing] = useState<{ userId: string; people: UserResult[] } | null>(null);
  // The highlighted option while the popover is open; -1 for none.
  const [active, setActive] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const id = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;

  // Close on outside click / Escape outside the field (the field's own
  // Escape is `onKeyDown`'s). The header search folds back into its icon; the
  // inline one only hides its results, keeping the field and what was typed.
  useEffect(() => {
    if (!open && !expanded) return;
    const dismiss = () => {
      setOpen(false);
      setActive(-1);
      if (!inline) {
        setExpanded(false);
        reset();
      }
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
  }, [open, expanded, inline]);

  // Debounced query. A response for a term that's since changed (or been
  // cleared) is dropped, so it can't overwrite newer results. Its first
  // result becomes the active option.
  useEffect(() => {
    const term = q.trim();
    setActive(-1);
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
          const nextUsers: UserResult[] = result.data.users || [];
          const nextLists: WishlistResult[] = result.data.wishlists || [];
          setUsers(nextUsers);
          setWishlists(nextLists);
          setActive(nextUsers.length + nextLists.length > 0 ? 0 : -1);
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

  // The people you follow, read each time the popover opens while signed in.
  // A read that fails or is still on its way shows nothing: never "you follow
  // no one".
  useEffect(() => {
    if (!open || !userId) return;
    let current = true;
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(userId)}/following`, {
          cache: 'no-store',
        });
        const result = await res.json();
        if (current && res.ok && result.success && Array.isArray(result.data)) {
          setFollowing({
            userId,
            people: (result.data as UserResult[])
              .slice(0, FOLLOWING_SUGGESTIONS)
              .map((u) => ({ username: u.username, image: u.image ?? null })),
          });
        }
      } catch {
        /* nothing to show */
      }
    })();
    return () => {
      current = false;
    };
  }, [open, userId]);

  function reset() {
    setQ('');
    setUsers([]);
    setWishlists([]);
    setActive(-1);
  }

  function collapse() {
    setOpen(false);
    setExpanded(false);
    reset();
  }

  function closeResults() {
    setOpen(false);
    setActive(-1);
  }

  function clear() {
    reset();
    inputRef.current?.focus();
  }

  function go(href: string) {
    collapse();
    router.push(href);
  }

  const term = q.trim();
  const followed = following && following.userId === userId ? following.people : null;
  const suggesting = term.length === 0 && !!followed;
  const options: Option[] =
    term.length >= 3
      ? [
          ...users.map(personOption),
          ...wishlists.map((w): Option => ({
            kind: 'list',
            key: `w:${w._id}`,
            href: `/wishlists/${w.slug ?? w._id}`,
            list: w,
          })),
        ]
      : suggesting
        ? followed.map(personOption)
        : [];
  const listShown = open && options.length > 0;
  const activeOption = listShown ? options[active] : undefined;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    const last = options.length - 1;
    let handled = true;
    if (e.key === 'Tab') {
      if (open) closeResults();
      return;
    } else if (e.key === 'ArrowDown') {
      if (!listShown) {
        setOpen(true);
        if (options.length) setActive(0);
      } else setActive(active === -1 ? 0 : Math.min(active + 1, last));
    } else if (e.key === 'ArrowUp') {
      if (!listShown) {
        setOpen(true);
        if (options.length) setActive(last);
      } else setActive(active === -1 ? last : Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      // Results for an earlier term may still be on screen while the new
      // one is searched: Enter waits for its own.
      if (loading) return;
      if (activeOption) go(activeOption.href);
      else {
        // The person whose username is exactly what was typed, with or
        // without its leading `@`, as the landing page's old find-by-username field did.
        const exact = users.find((u) => u.username === usernameQuery(q));
        if (exact) go(`/users/${exact.username}`);
        else return;
      }
    } else if (e.key === 'Escape') {
      if (open) closeResults();
      else if (!inline) collapse();
      else return;
    } else handled = false;

    if (!handled) return;
    e.preventDefault();
    // The field's key, not the page's: the listener on `document` would fold
    // the header search on the Escape that only closes its results.
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
  }

  if (!inline && !expanded) {
    return (
      <IconButton
        icon="search"
        label="Search"
        onClick={() => {
          setExpanded(true);
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
        variant="chrome"
        size="md"
        shape="pill"
      />
    );
  }

  const hasResults = users.length > 0 || wishlists.length > 0;
  const dropdownClass = inline
    ? `animate-fade-in absolute inset-x-0 top-full z-20 mt-2 overflow-hidden text-left ${POPOVER_SURFACE}`
    : `animate-fade-in absolute left-4 right-4 top-[3.5rem] overflow-hidden ${POPOVER_SURFACE} sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80`;

  let note: string | null = null;
  if (term.length > 0 && term.length < 3) note = 'Type at least 3 characters';
  else if (term.length >= 3 && !hasResults)
    note = loading ? 'Searching…' : `No matches for “${term}”.`;
  else if (suggesting && followed.length === 0)
    note = 'Search for people by username, or for wishlists by name.';

  const row = (o: Option, i: number) => (
    <ResultRow
      key={o.key}
      option={o}
      optionId={optionId(i)}
      isActive={i === active}
      onPick={() => go(o.href)}
      onHover={() => {
        if (i !== active) setActive(i);
      }}
    />
  );
  const peopleCount = term.length >= 3 ? users.length : options.length;

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
        <Icon
          name="search"
          size={inline ? 18 : 16}
          className="flex-shrink-0 text-muted-foreground"
        />
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={listShown}
          aria-controls={listShown ? listboxId : undefined}
          aria-activedescendant={activeOption ? optionId(active) : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search people & wishlists"
          aria-label="Search people and wishlists"
          className={`${inline ? 'h-11' : 'h-10'} min-w-0 flex-1 border-0 bg-transparent text-body outline-hidden`}
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

      {open && (note !== null || listShown) && (
        <div
          // Keep focus in the field: a click on a row would otherwise move it.
          onMouseDown={(e) => e.preventDefault()}
          className={dropdownClass}
        >
          {note !== null && (
            <p role="status" className={POPOVER_NOTE}>
              {note}
            </p>
          )}
          {listShown && (
            <div
              id={listboxId}
              role="listbox"
              aria-label={suggesting ? 'People you follow' : 'Search results'}
            >
              {peopleCount > 0 && (
                <div role="group" aria-labelledby={`${id}-people`}>
                  <p id={`${id}-people`} className={POPOVER_GROUP_LABEL}>
                    {suggesting ? 'People you follow' : 'People'}
                  </p>
                  {options.slice(0, peopleCount).map((o, i) => row(o, i))}
                </div>
              )}
              {!suggesting && wishlists.length > 0 && (
                <div role="group" aria-labelledby={`${id}-lists`}>
                  <p id={`${id}-lists`} className={POPOVER_GROUP_LABEL}>
                    Wishlists
                  </p>
                  {options.slice(peopleCount).map((o, i) => row(o, peopleCount + i))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One result: a person or a list, an option of the listbox. */
function ResultRow({
  option,
  optionId,
  isActive,
  onPick,
  onHover,
}: {
  option: Option;
  optionId: string;
  isActive: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const nameId = `${optionId}-name`;
  const metaId = `${optionId}-meta`;
  let meta: string | null;
  let visual: React.ReactNode;
  let name: string;
  if (option.kind === 'person') {
    const { user } = option;
    name = `@${user.username}`;
    meta = user.relation ? RELATION_LABEL[user.relation] : null;
    visual = <Avatar name={user.username} src={user.image} size="sm" />;
  } else {
    const { list } = option;
    name = list.name;
    // Your own list says so in place of its owner; anyone else's names its
    // primary owner, and a list you're on adds that you are.
    meta =
      list.relation === 'owner'
        ? RELATION_LABEL.owner
        : [
            list.ownerUsername && `@${list.ownerUsername}`,
            list.relation === 'member' && RELATION_LABEL.member,
          ]
            .filter(Boolean)
            .join(' · ') || null;
    visual = (
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary-500/12 text-accent">
        <Icon name="gift" size={16} />
      </span>
    );
  }
  return (
    <div
      id={optionId}
      role="option"
      aria-selected={isActive}
      // Named by the name alone, and described by its meta line, so it reads
      // "@hannah_s, Friend" rather than "@hannah_sFriend".
      aria-labelledby={nameId}
      aria-describedby={meta ? metaId : undefined}
      onClick={onPick}
      // Not on mouseenter, which also fires when the results change under a
      // still pointer.
      onMouseMove={onHover}
      className={`${POPOVER_OPTION_ROW} cursor-pointer transition-colors ${
        isActive ? 'bg-row-active' : 'hover:bg-muted'
      }`}
    >
      {visual}
      <span className="min-w-0">
        <span id={nameId} className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {meta && (
          <span id={metaId} className="block truncate text-xs font-normal text-muted-foreground">
            {meta}
          </span>
        )}
      </span>
    </div>
  );
}
