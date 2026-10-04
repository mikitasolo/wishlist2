'use client';

import { useState } from 'react';
import Button from '@/components/Button';
import ConfirmDialog from '@/components/ConfirmDialog';
import Field from '@/components/Field';
import Input from '@/components/Input';
import { PanelSection } from '@/components/Panel';
import { useToast } from '@/components/ToastProvider';
import {
  DELETE_ACCOUNT_COPY,
  DELETE_ACCOUNT_WARNING,
  soleOwnedListsNote,
} from '@/lib/utils/confirmationCopy';
import {
  deletionConfirmationTarget,
  matchesDeletionConfirmation,
} from '@/lib/utils/deletionConfirmation';

const UNFINISHED = 'Couldn’t finish deleting your account. Sign in again to finish it.';

type SoleOwnedLists =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'loaded'; lists: Array<{ _id: string; name: string }> };

/**
 * Settings → Account's Danger zone (WIS-276): Delete account…, behind a
 * confirmation that names the lists going with it and takes the username (or
 * the email, without one) typed out. The server erases everything and ends the
 * account's sessions; `onDeleted` then signs this browser out to the home page.
 *
 * Delete stays held until those lists have been read: the confirmation has to
 * name them, and a failed read never reads as "no lists".
 */
export default function DeleteAccount({
  username,
  email,
  onDeleted,
  onSignInAgain,
}: {
  username: string;
  email: string;
  onDeleted: () => void;
  /** Sign out to sign-in, coming back here, to finish a deletion that stopped part-way. */
  onSignInAgain: () => void;
}) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [lists, setLists] = useState<SoleOwnedLists>({ state: 'loading' });
  const target = deletionConfirmationTarget({ username, email });
  const confirmed = matchesDeletionConfirmation(typed, target);

  async function loadLists() {
    setLists({ state: 'loading' });
    try {
      const res = await fetch('/api/users/me/deletion');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error('read failed');
      setLists({ state: 'loaded', lists: json.data.soleOwnedLists });
    } catch {
      setLists({ state: 'failed' });
    }
  }

  function openDialog() {
    setTyped('');
    setOpen(true);
    void loadLists();
  }

  /**
   * The deletion may have stopped part-way, after the server ended this
   * account's sessions: the account is still there, but only signing in again
   * lets them finish, so that's what the toast offers.
   */
  function stoppedPartWay() {
    setOpen(false);
    showToast(UNFINISHED, 'error', { action: { label: 'Sign in', onClick: onSignInAgain } });
  }

  async function deleteNow() {
    if (lists.state !== 'loaded') return;
    let res: Response;
    try {
      res = await fetch('/api/users/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed, lists: lists.lists.map((l) => l._id) }),
      });
    } catch {
      stoppedPartWay();
      return;
    }
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.success) {
      onDeleted();
      return;
    }
    // Refused before anything changed: the wrong confirmation, too many tries,
    // or a list that has become theirs alone since (read again, to be named).
    if (res.status === 409) void loadLists();
    if (res.status === 400 || res.status === 409 || res.status === 429) {
      showToast(json.error || 'Couldn’t delete your account. Try again.', 'error');
      return;
    }
    stoppedPartWay();
  }

  return (
    <>
      <PanelSection title="Danger zone">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Delete account</p>
            <p className="mt-1 text-sm text-muted-foreground">{DELETE_ACCOUNT_WARNING}</p>
          </div>
          <div className="flex-shrink-0">
            <Button variant="danger" icon="trash" onClick={openDialog}>
              Delete account…
            </Button>
          </div>
        </div>
      </PanelSection>

      <ConfirmDialog
        isOpen={open}
        type="danger"
        title={DELETE_ACCOUNT_COPY.title}
        message={DELETE_ACCOUNT_COPY.message}
        confirmText="Delete account"
        pendingText="Deleting…"
        onConfirm={deleteNow}
        onCancel={() => setOpen(false)}
        confirmDisabled={!confirmed || lists.state !== 'loaded'}
      >
        <div className="mt-4 space-y-4">
          <SoleOwnedListsNote lists={lists} />
          <Field
            label={
              target.kind === 'username' ? (
                <>
                  Type <span className="font-semibold">{target.value}</span> to confirm
                </>
              ) : (
                'Type your email to confirm'
              )
            }
          >
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
        </div>
      </ConfirmDialog>
    </>
  );
}

function SoleOwnedListsNote({ lists }: { lists: SoleOwnedLists }) {
  if (lists.state === 'loading') {
    return <p className="text-sm text-muted-foreground">Checking which lists you own alone…</p>;
  }
  if (lists.state === 'failed') {
    return (
      <p role="alert" className="text-sm text-danger">
        Couldn’t check which lists you own alone. Close this and try again.
      </p>
    );
  }
  return (
    <div>
      <p className="text-sm text-muted-foreground">{soleOwnedListsNote(lists.lists.length)}</p>
      {lists.lists.length > 0 && (
        <ul
          aria-label="Lists deleted with your account"
          className="mt-2 max-h-36 list-disc space-y-1 overflow-y-auto pl-5 text-sm text-foreground"
        >
          {lists.lists.map((l) => (
            <li key={l._id} className="break-words">
              {l.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
