'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import Select from './Select';
import { TONE_CLASSES } from '@/lib/utils/statusTones';
import Button from './Button';
import SearchField from './SearchField';

type Role = 'owner' | 'member';

export interface InviteMemberFormHandle {
  /**
   * Set the form up to invite a co-owner: the Owner role picked, the form
   * scrolled into view and the cursor in its username field. The sole owner's
   * "Invite a co-owner" (from Leave on their own row) lands here.
   */
  startOwnerInvite(): void;
}

interface InviteMemberFormProps {
  onInvite: (payload: { username: string; role: Role }) => Promise<void>;
  isInviting: boolean;
  ref?: Ref<InviteMemberFormHandle>;
}

/**
 * Invite form — you can only invite people who already have an account, so it
 * searches by username with live, search-style suggestions of matching people.
 */
export default function InviteMemberForm({ onInvite, isInviting, ref }: InviteMemberFormProps) {
  const [value, setValue] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [suggestions, setSuggestions] = useState<{ username: string; image?: string | null }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      startOwnerInvite() {
        setRole('owner');
        // To its top, so the owner warning the role adds shows below it.
        // (jsdom has no scrollIntoView or matchMedia.)
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
  useEffect(() => {
    const term = value.trim().replace(/^@/, '');
    if (term.length < 3) {
      setSuggestions([]);
      setLoadingSuggest(false);
      return;
    }
    setLoadingSuggest(true);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, sections: 'users' });
        const res = await fetch(`/api/search?${params}`, { cache: 'no-store' });
        const result = await res.json();
        if (result.success) setSuggestions((result.data.users || []).slice(0, 5));
      } catch {
        /* ignore */
      } finally {
        setLoadingSuggest(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value]);

  // Close suggestions on outside click
  useEffect(() => {
    if (!showSuggestions) return;
    const onPointer = (e: MouseEvent) => {
      if (fieldRef.current && !fieldRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [showSuggestions]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    await onInvite({ username: raw.replace(/^@/, '').toLowerCase(), role });
    setValue('');
    setRole('member');
    setSuggestions([]);
    setShowSuggestions(false);
  }

  const term = value.trim().replace(/^@/, '');

  return (
    // scroll-mt clears the sticky app header (h-14) when it's scrolled to.
    <div
      ref={cardRef}
      className="scroll-mt-20 rounded-2xl border border-border bg-surface p-5 shadow-md sm:p-6"
    >
      <h2 className="mb-1 text-lg font-semibold text-foreground">Invite someone</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Search for someone by username. They’ll join this wishlist once they accept.
      </p>

      {role === 'owner' && (
        <p className={`mb-4 flex gap-2 rounded-xl p-3 text-sm ${TONE_CLASSES.warning.tint}`}>
          <Icon name="alert" size={16} className="mt-0.5 flex-shrink-0" />
          <span>
            An owner gets the same full control you have, including deleting this wishlist, and it
            appears on their profile as their own. Owners never see booking status, so anything
            they’ve already booked here is released when they accept.
          </span>
        </p>
      )}

      <form
        onSubmit={submit}
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        autoComplete="off"
      >
        {/* Field + suggestions */}
        <div ref={fieldRef} className="relative flex-1">
          <SearchField
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            placeholder="Search by username"
            required
            disabled={isInviting}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />

          {showSuggestions && term.length >= 3 && (
            <div className="animate-fade-in absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-surface py-1.5 shadow-lg">
              {loadingSuggest && suggestions.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
              )}
              {!loadingSuggest && suggestions.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">No people match “{term}”.</p>
              )}
              {suggestions.map((u) => (
                <button
                  key={u.username}
                  type="button"
                  onClick={() => {
                    setValue(u.username);
                    setShowSuggestions(false);
                  }}
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
        </div>

        <Select
          value={role}
          onChange={(v) => setRole(v as Role)}
          ariaLabel="Role"
          disabled={isInviting}
          size="md"
          triggerClassName="w-full sm:w-32"
          options={[
            { value: 'member', label: 'Member' },
            { value: 'owner', label: 'Owner' },
          ]}
        />

        <Button type="submit" disabled={isInviting} className="whitespace-nowrap">
          {isInviting ? 'Inviting…' : 'Invite'}
        </Button>
      </form>
    </div>
  );
}
