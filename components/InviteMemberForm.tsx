'use client';

import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import Select from './Select';

type Mode = 'username' | 'email';
type Role = 'admin' | 'member';

interface InviteMemberFormProps {
  onInvite: (payload: { email?: string; username?: string; role: Role }) => Promise<void>;
  isInviting: boolean;
}

/**
 * Invite form with an explicit "By username / By email" mode toggle.
 * In username mode it shows live, search-style suggestions of matching people.
 */
export default function InviteMemberForm({ onInvite, isInviting }: InviteMemberFormProps) {
  const [mode, setMode] = useState<Mode>('username');
  const [value, setValue] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [suggestions, setSuggestions] = useState<{ username: string; image?: string | null }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  // Live username suggestions (username mode only), reusing the search endpoint.
  useEffect(() => {
    if (mode !== 'username') {
      setSuggestions([]);
      setLoadingSuggest(false);
      return;
    }
    const term = value.trim().replace(/^@/, '');
    if (term.length < 3) {
      setSuggestions([]);
      setLoadingSuggest(false);
      return;
    }
    setLoadingSuggest(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { cache: 'no-store' });
        const result = await res.json();
        if (result.success) setSuggestions((result.data.users || []).slice(0, 5));
      } catch {
        /* ignore */
      } finally {
        setLoadingSuggest(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value, mode]);

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

  function switchMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    setValue('');
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = value.trim();
    if (!raw) return;
    const payload =
      mode === 'email'
        ? { email: raw, role }
        : { username: raw.replace(/^@/, '').toLowerCase(), role };
    await onInvite(payload);
    setValue('');
    setRole('member');
    setSuggestions([]);
    setShowSuggestions(false);
  }

  const term = value.trim().replace(/^@/, '');

  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-md sm:p-6">
      <h2 className="mb-1 text-lg font-semibold text-foreground">Invite someone</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        They’ll join this wishlist once they sign in.
      </p>

      {/* Mode toggle: by username or by email */}
      <div className="relative mb-3 flex w-full max-w-xs rounded-xl border border-border bg-surface-2 p-1">
        <span
          aria-hidden
          className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
          style={{
            width: 'calc((100% - 0.5rem) / 2)',
            left: `calc(${mode === 'username' ? 0 : 1} * ((100% - 0.5rem) / 2) + 0.25rem)`,
          }}
        />
        {(['username', 'email'] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            disabled={isInviting}
            className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-sm font-semibold transition-colors ${
              mode === m ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon name={m === 'username' ? 'user' : 'mail'} size={14} />
            {m === 'username' ? 'By username' : 'By email'}
          </button>
        ))}
      </div>

      <form
        onSubmit={submit}
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        autoComplete="off"
      >
        {/* Field + suggestions */}
        <div ref={fieldRef} className="relative flex-1">
          <div className="flex h-11 items-center gap-2 rounded-xl border border-border-strong bg-surface px-3.5">
            <Icon
              name={mode === 'username' ? 'search' : 'mail'}
              size={16}
              className="flex-shrink-0 text-muted-foreground"
            />
            <input
              type={mode === 'email' ? 'email' : 'text'}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder={mode === 'username' ? 'Search by username' : 'name@email.com'}
              required
              className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] outline-none"
              disabled={isInviting}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          {mode === 'username' && showSuggestions && term.length >= 3 && (
            <div className="animate-fade-in absolute left-0 right-0 z-20 mt-2 overflow-hidden rounded-2xl border border-border bg-surface py-1.5 shadow-lg">
              {loadingSuggest && suggestions.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">Searching…</p>
              )}
              {!loadingSuggest && suggestions.length === 0 && (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  No people match “{term}”. You can still send the invite.
                </p>
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
            { value: 'admin', label: 'Admin' },
          ]}
        />

        <button
          type="submit"
          disabled={isInviting}
          className="inline-flex h-11 items-center justify-center rounded-xl bg-primary-600 px-6 text-[15px] font-semibold text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)] transition-all hover:bg-primary-500 active:scale-[0.98] disabled:opacity-45 whitespace-nowrap"
        >
          {isInviting ? 'Inviting…' : 'Invite'}
        </button>
      </form>
    </div>
  );
}
