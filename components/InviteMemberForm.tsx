'use client';

import {
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
} from 'react';
import Avatar from './Avatar';
import Panel from './Panel';
import Button from './Button';
import SearchField from './SearchField';
import SegmentedControl from './SegmentedControl';
import { POPOVER_NOTE, POPOVER_OPTION_ROW, POPOVER_SURFACE } from './popoverStyles';
import {
  INVITE_SEARCH_MIN_CHARS,
  LIST_STATUS_LABEL,
  inviteSearchTerm,
  type ListPerson,
} from '@/lib/utils/inviteSuggestions';

type Role = 'owner' | 'member';

/** What each role can do, under the role switch. */
export const ROLE_HELPER: Record<Role, string> = {
  member: 'Can reserve gifts and propose items.',
  owner: 'Can edit everything, and never sees reservations.',
};

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'owner', label: 'Co-owner' },
] as const;

/** How many suggestions show at once. */
const MAX_SUGGESTIONS = 5;

export interface InviteMemberFormHandle {
  /**
   * Set the form up to invite a co-owner: the Co-owner role picked, the form
   * scrolled into view and the cursor in its username field. The sole owner's
   * "Invite a co-owner" (from Leave on their own row) lands here.
   */
  startOwnerInvite(): void;
}

interface InviteMemberFormProps {
  onInvite: (payload: { username: string; role: Role }) => Promise<void>;
  isInviting: boolean;
  /**
   * Who's on the list already, by lower-cased username (`listStatusByUsername`):
   * their suggestions show it and can't be picked.
   */
  statuses?: ReadonlyMap<string, ListPerson>;
  /**
   * A member's suggestion offers to make them a co-owner instead, which the
   * page runs as its members' Make owner: the confirmation, then the promotion
   * invite. Without it, a member's suggestion offers nothing.
   */
  onPromote?: (member: { userId: string; username: string }) => void;
  ref?: Ref<InviteMemberFormHandle>;
}

interface SuggestedUser {
  username: string;
  image?: string | null;
}

/** An option in the suggestions: a person, or the promotion a member's row offers. */
type SuggestionOption =
  | { kind: 'person'; user: SuggestedUser; person?: ListPerson }
  | { kind: 'promote'; user: SuggestedUser; userId: string };

type SearchState = 'idle' | 'loading' | 'done' | 'failed';

/**
 * Invite form. You can only invite people who already have an account, so it
 * searches by username, with live suggestions of matching people.
 *
 * The field is a WAI-ARIA combobox with a listbox popup, on `Select`'s
 * keyboard model: focus stays in the field, ↓ and ↑ move the active option
 * (`aria-activedescendant`), Enter picks it, and Escape or Tab closes the list.
 * The open list's Escape stops at the field, so it doesn't also close a dialog
 * around it. With no active option, Enter sends the invite as typed.
 *
 * A suggestion for someone already on the list (an owner, a member, someone
 * invited) says so and can't be picked; a member's offers "Make co-owner
 * instead", the page's promotion.
 */
export default function InviteMemberForm({
  onInvite,
  isInviting,
  statuses,
  onPromote,
  ref,
}: InviteMemberFormProps) {
  const [value, setValue] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([]);
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [open, setOpen] = useState(false);
  // The highlighted option while the list is open; -1 for none.
  const [active, setActive] = useState(-1);
  const cardRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Set when the keyboard moves the active option, so it's scrolled into view.
  const scrollToActive = useRef(false);

  const id = useId();
  const listboxId = `${id}-listbox`;
  const helperId = `${id}-role-helper`;
  const optionId = (i: number) => `${id}-option-${i}`;

  const term = inviteSearchTerm(value);

  useImperativeHandle(
    ref,
    () => ({
      startOwnerInvite() {
        setRole('owner');
        // To its top, so the whole form shows. (jsdom has no scrollIntoView
        // or matchMedia.)
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        cardRef.current?.scrollIntoView?.({
          block: 'start',
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
        inputRef.current?.focus({ preventScroll: true });
      },
    }),
    []
  );

  // Live username suggestions, from the search endpoint's people section only
  // (`sections=users`), so it doesn't run the wishlist search for nothing.
  // regression (WIS-186): only the current term's answer lands. A slower
  // answer for an earlier term (or for a field a sent invite has since
  // cleared) is dropped, as `GlobalSearch` does, and a failed search is
  // shown as one, never as "No people match".
  useEffect(() => {
    if (term.length < INVITE_SEARCH_MIN_CHARS) {
      setSuggestions([]);
      setSearchState('idle');
      return;
    }
    setSearchState('loading');
    let current = true;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, sections: 'users' });
        const res = await fetch(`/api/search?${params}`, { cache: 'no-store' });
        const result = await res.json();
        if (!current) return;
        if (result?.success) {
          setSuggestions((result.data?.users || []).slice(0, MAX_SUGGESTIONS));
          setSearchState('done');
        } else {
          setSuggestions([]);
          setSearchState('failed');
        }
      } catch {
        if (!current) return;
        setSuggestions([]);
        setSearchState('failed');
      }
    }, 250);
    return () => {
      current = false;
      clearTimeout(t);
    };
  }, [term]);

  // The options in list order: each person, then a member's promotion.
  const options = useMemo(() => {
    const list: SuggestionOption[] = [];
    for (const user of suggestions) {
      const person = statuses?.get(user.username.toLowerCase());
      list.push({ kind: 'person', user, person });
      if (person?.status === 'member' && person.userId && onPromote) {
        list.push({ kind: 'promote', user, userId: person.userId });
      }
    }
    return list;
  }, [suggestions, statuses, onPromote]);

  // New suggestions start with nothing highlighted.
  useEffect(() => setActive(-1), [options]);

  // A disabled field can't take keys, and can lose focus without a blur.
  if (isInviting && open) setOpen(false);

  const popoverShown = open && term.length > 0;
  const listShown = popoverShown && term.length >= INVITE_SEARCH_MIN_CHARS && options.length > 0;
  const activeOption = listShown ? options[active] : undefined;

  // Scroll the list (never the page) to the option the keyboard moved to.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!listShown || !list || !scrollToActive.current) return;
    scrollToActive.current = false;
    const el = list.querySelector<HTMLElement>(`[id="${optionId(active)}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
    // optionId only depends on `id`, which never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listShown, active]);

  const isDisabled = (o: SuggestionOption) => o.kind === 'person' && !!o.person;

  const moveTo = (i: number) => {
    setActive(i);
    scrollToActive.current = true;
  };

  function choose(o: SuggestionOption) {
    if (isDisabled(o)) return;
    setOpen(false);
    setActive(-1);
    if (o.kind === 'promote') {
      onPromote?.({ userId: o.userId, username: o.user.username });
      return;
    }
    setValue(o.user.username);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    const last = options.length - 1;
    let handled = true;
    if (e.key === 'Tab') {
      if (open) setOpen(false);
      return;
    } else if (e.key === 'ArrowDown') {
      if (!listShown) {
        setOpen(true);
        if (term.length >= INVITE_SEARCH_MIN_CHARS && options.length > 0) moveTo(0);
      } else moveTo(active === -1 ? 0 : Math.min(active + 1, last));
    } else if (e.key === 'ArrowUp') {
      if (!listShown) {
        setOpen(true);
        if (term.length >= INVITE_SEARCH_MIN_CHARS && options.length > 0) moveTo(last);
      } else moveTo(active === -1 ? last : Math.max(active - 1, 0));
    } else if (e.key === 'Enter') {
      // With no active option, Enter sends the invite as typed.
      if (!activeOption) return;
      choose(activeOption);
    } else if (e.key === 'Escape') {
      if (!popoverShown) return;
      setOpen(false);
      setActive(-1);
    } else handled = false;

    if (!handled) return;
    e.preventDefault();
    if (popoverShown) {
      // The list's key, not the page's: see Select. A dialog around the form
      // closes on Escape from a keydown listener on `document`.
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    await onInvite({ username: raw.replace(/^@/, '').toLowerCase(), role });
    setValue('');
    setRole('member');
    setSuggestions([]);
    setOpen(false);
  }

  let note: string | null = null;
  if (term.length < INVITE_SEARCH_MIN_CHARS) note = 'Type at least 3 letters of their username';
  else if (searchState === 'failed')
    note = 'Suggestions aren’t available right now. You can still invite them by username.';
  else if (suggestions.length === 0)
    note = searchState === 'done' ? `No people match “${term}”.` : 'Searching…';

  return (
    // scroll-mt clears the sticky app header (h-14) when it's scrolled to.
    <Panel
      ref={cardRef}
      title="Invite someone"
      description="Search for someone by username. They’ll join this wishlist once they accept."
      className="scroll-mt-20"
    >
      <form
        onSubmit={submit}
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_13rem_auto] sm:items-center"
        autoComplete="off"
      >
        {/* Field + suggestions */}
        <div className="relative">
          <SearchField
            ref={inputRef}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={listShown}
            aria-controls={listShown ? listboxId : undefined}
            aria-activedescendant={activeOption ? optionId(active) : undefined}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            // On a click, not on focus: focus coming back from the promotion's
            // dialog, or from "Invite a co-owner", shouldn't pop the list open.
            onClick={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder="Search by username"
            aria-label="Search by username"
            required
            disabled={isInviting}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />

          {popoverShown && (
            <div
              // Keep focus in the field: a click in the list would otherwise
              // blur it, and the blur close the list before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              className={`animate-fade-in absolute left-0 right-0 z-20 mt-2 max-h-80 overflow-auto ${POPOVER_SURFACE}`}
            >
              {note !== null && (
                <p role="status" className={POPOVER_NOTE}>
                  {note}
                </p>
              )}
              {listShown && (
                <div ref={listRef} id={listboxId} role="listbox" aria-label="People">
                  {options.map((o, i) => {
                    if (o.kind === 'promote') return null;
                    const promote = options[i + 1]?.kind === 'promote' ? i + 1 : -1;
                    return (
                      <SuggestionRow
                        key={o.user.username}
                        option={o}
                        optionId={optionId(i)}
                        isActive={i === active}
                        onPick={() => choose(o)}
                        onHover={() => setActive(i)}
                        promote={
                          promote === -1
                            ? undefined
                            : {
                                optionId: optionId(promote),
                                isActive: promote === active,
                                onPick: () => choose(options[promote]),
                                onHover: () => setActive(promote),
                              }
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <SegmentedControl
          options={ROLE_OPTIONS}
          value={role}
          onChange={setRole}
          ariaLabel="Role"
          ariaDescribedBy={helperId}
          disabled={isInviting}
        />

        <p
          id={helperId}
          className="text-xs text-muted-foreground sm:col-span-2 sm:col-start-2 sm:row-start-2"
        >
          {ROLE_HELPER[role]}
        </p>

        <Button
          type="submit"
          disabled={isInviting}
          className="whitespace-nowrap sm:col-start-3 sm:row-start-1"
        >
          {isInviting ? 'Inviting…' : 'Invite'}
        </Button>
      </form>
    </Panel>
  );
}

interface RowAction {
  optionId: string;
  isActive: boolean;
  onPick: () => void;
  onHover: () => void;
}

/**
 * One person in the suggestions, and, for a member, the promotion offered
 * beside them (below them on a phone), as a second option of its own.
 */
function SuggestionRow({
  option,
  optionId,
  isActive,
  onPick,
  onHover,
  promote,
}: {
  option: Extract<SuggestionOption, { kind: 'person' }>;
  promote?: RowAction;
} & RowAction) {
  const { user, person } = option;
  const disabled = !!person;
  return (
    <div role="none" className="flex flex-col sm:flex-row sm:items-center sm:gap-1">
      <div
        id={optionId}
        role="option"
        aria-selected={isActive}
        aria-disabled={disabled || undefined}
        // Named by the username alone, and described by the status, so it
        // reads "@bob, Member" rather than "@bobMember".
        aria-labelledby={`${optionId}-name`}
        aria-describedby={person ? `${optionId}-status` : undefined}
        onClick={onPick}
        // Not on mouseenter, which also fires when the keyboard scrolls the
        // list under a still pointer.
        onMouseMove={() => {
          if (!isActive) onHover();
        }}
        className={`${POPOVER_OPTION_ROW} min-w-0 flex-1 transition-colors ${
          isActive ? 'bg-row-active' : disabled ? '' : 'hover:bg-muted'
        } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
      >
        <Avatar
          name={user.username}
          src={user.image}
          size="sm"
          className={disabled ? 'opacity-60' : ''}
        />
        <span className="min-w-0 flex-1">
          <span
            id={`${optionId}-name`}
            className={`block truncate ${disabled ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            @{user.username}
          </span>
          {person && (
            <span
              id={`${optionId}-status`}
              className="block text-xs font-normal text-muted-foreground"
            >
              {LIST_STATUS_LABEL[person.status]}
            </span>
          )}
        </span>
      </div>
      {promote && (
        <div
          id={promote.optionId}
          role="option"
          aria-selected={promote.isActive}
          // The visible words first, then whose row it's on.
          aria-label={`Make co-owner instead, @${user.username}`}
          onClick={promote.onPick}
          onMouseMove={() => {
            if (!promote.isActive) promote.onHover();
          }}
          className={`flex flex-shrink-0 cursor-pointer items-center self-start whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-accent transition-colors max-sm:ml-10.5 sm:self-auto ${
            promote.isActive ? 'bg-row-active' : 'hover:bg-muted'
          }`}
        >
          Make co-owner instead
        </div>
      )}
    </div>
  );
}
