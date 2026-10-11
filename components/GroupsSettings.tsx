'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import Avatar from './Avatar';
import BaseModal from './BaseModal';
import Button from './Button';
import EmptyState from './EmptyState';
import Field from './Field';
import IconButton from './IconButton';
import Input from './Input';
import LoadError from './LoadError';
import Menu from './Menu';
import NewGroupForm from './NewGroupForm';
import Panel from './Panel';
import SearchField from './SearchField';
import { Skeleton } from './Skeleton';
import { useToast } from './ToastProvider';
import { iconButtonClassName } from './buttonStyles';
import { POPOVER_OPTION_ROW } from './popoverStyles';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { useUndoableAction } from '@/lib/hooks/useUndoableAction';
import type { PendingCommit } from '@/lib/utils/deferredCommit';
import { usePeopleGroups, type GroupPerson, type GroupView } from '@/lib/hooks/usePeopleGroups';
import {
  GROUP_MEMBER_LIMIT,
  GROUP_MEMBER_SEARCH_MIN,
  groupLimitNote,
  personMatches,
} from '@/lib/utils/groupRules';
import { GROUP_NAME_MAX } from '@/lib/validations';
import { plural } from '@/lib/utils/plural';

const CHECKBOX = 'h-4 w-4 flex-shrink-0 cursor-pointer accent-primary-600';
const MENU_TRIGGER = iconButtonClassName({ variant: 'ghost', size: 'sm' });

/** The people you follow, as the Add people dialog lists them. */
interface FollowedPerson {
  _id: string;
  username: string;
  image?: string | null;
}

/**
 * Settings → Groups (WIS-27): make, rename and delete your groups, and tag the
 * people you follow into them. Private to you: nobody is told they're in one.
 */
export default function GroupsSettings() {
  const { data: session } = useKnownSession();
  const userId = session?.user?.id;
  const { groups, failed, retry, create, rename, removeDeferred, setTagged, untagDeferred } =
    usePeopleGroups();
  const { showToast } = useToast();
  const offerUndo = useUndoableAction();
  const [renaming, setRenaming] = useState<GroupView | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const addingGroup = groups?.find((g) => g.id === adding) ?? null;
  // Untags still waiting out their Undo window, by `group:person`, so tagging
  // that person back in meanwhile is their Undo rather than a second request.
  const pendingUntags = useRef(new Map<string, PendingCommit>());

  // Arriving from a profile's Manage groups (`/settings#groups`): the page drew
  // its skeleton first, so the browser found nothing to scroll to.
  useEffect(() => {
    if (window.location.hash === '#groups') document.getElementById('groups')?.scrollIntoView();
  }, []);

  // Taking someone out of a group, and deleting one, wait out an Undo window
  // before they're sent (WIS-387); undone, nothing is.
  function untag(group: GroupView, person: GroupPerson) {
    const key = `${group.id}:${person.id}`;
    const deferred = untagDeferred(group.id, person);
    if (!deferred) return;
    const pending = offerUndo({
      message: `Removed from ${group.name}`,
      commit: async ({ keepalive }) => {
        const error = await deferred.commit(keepalive);
        if (error) showToast(error, 'error');
      },
      onUndo: deferred.restore,
    });
    pendingUntags.current.set(key, pending);
    void pending.settled.then(() => {
      if (pendingUntags.current.get(key) === pending) pendingUntags.current.delete(key);
    });
  }

  function deleteGroup(group: GroupView) {
    const deferred = removeDeferred(group.id);
    if (!deferred) return;
    offerUndo({
      message: `Deleted ${group.name}`,
      commit: async ({ keepalive }) => {
        const error = await deferred.commit(keepalive);
        if (error) showToast(error, 'error');
      },
      onUndo: deferred.restore,
    });
  }

  return (
    <Panel
      id="groups"
      className="mb-6 scroll-mt-24"
      title="Groups"
      description="Tag people you follow, like Family or Close friends. Only you can see your groups and who’s in them, and nobody is told. Unfollowing someone takes them out of your groups."
    >
      {groups === null && failed ? (
        <LoadError compact level={3} title="Couldn’t load your groups" onRetry={retry} />
      ) : groups === null ? (
        <GroupsBodySkeleton />
      ) : (
        <div className="space-y-4">
          {groups.length === 0 ? (
            <EmptyState
              compact
              tone="muted"
              icon="tag"
              level={3}
              title="No groups yet"
              body="Make one below, then add people to it here or from their profile."
            />
          ) : (
            groups.map((group) => (
              <section
                key={group.id}
                aria-label={group.name}
                className="rounded-xl border border-border"
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold text-foreground">
                      {group.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {plural(group.members.length, 'person')}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="user-plus"
                    onClick={() => setAdding(group.id)}
                    disabled={!userId}
                    aria-label={`Add people to ${group.name}`}
                  >
                    Add people
                  </Button>
                  <Menu
                    label={`Actions for ${group.name}`}
                    icon="more"
                    triggerClassName={MENU_TRIGGER}
                    items={[
                      { label: 'Rename', icon: 'edit', onSelect: () => setRenaming(group) },
                      {
                        label: 'Delete group',
                        icon: 'trash',
                        danger: true,
                        onSelect: () => deleteGroup(group),
                      },
                    ]}
                  />
                </div>
                {group.members.length > 0 && (
                  <GroupMembers group={group} onRemove={(person) => untag(group, person)} />
                )}
              </section>
            ))
          )}
          <NewGroupForm
            onCreate={async (name) => {
              const made = await create(name);
              return 'error' in made ? made.error : null;
            }}
            atLimit={groupLimitNote(groups.length)}
          />
        </div>
      )}

      {renaming && (
        <RenameGroupDialog
          group={renaming}
          onClose={() => setRenaming(null)}
          onRename={(name) => rename(renaming.id, name)}
        />
      )}
      {addingGroup && userId && (
        <AddPeopleDialog
          userId={userId}
          group={addingGroup}
          onClose={() => setAdding(null)}
          onToggle={async (person, on) => {
            // Ticked back while their removal still waits: that's its Undo.
            if (on && pendingUntags.current.get(`${addingGroup.id}:${person.id}`)?.undo()) return;
            const error = await setTagged(addingGroup.id, person, on);
            if (error) showToast(error, 'error');
          }}
        />
      )}
    </Panel>
  );
}

/** A group's people, with a search once there are enough to scroll. */
function GroupMembers({
  group,
  onRemove,
}: {
  group: GroupView;
  onRemove: (person: GroupPerson) => void;
}) {
  const [query, setQuery] = useState('');
  const searchable = group.members.length > GROUP_MEMBER_SEARCH_MIN;
  const shown = searchable ? group.members.filter((p) => personMatches(p, query)) : group.members;
  return (
    <div className="border-t border-border">
      {searchable && (
        <div className="px-4 py-2">
          <SearchField
            size="sm"
            aria-label={`Search people in ${group.name}`}
            placeholder="Search this group"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
          />
        </div>
      )}
      {shown.length === 0 ? (
        <p role="status" className="px-4 pb-3 text-sm text-muted-foreground">
          No one in this group matches.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((person) => (
            <li key={person.id} className="flex items-center gap-3 px-4 py-2">
              <Avatar name={person.displayName} src={person.image} size="sm" />
              <Link
                href={`/users/${encodeURIComponent(person.username)}`}
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-colors hover:text-accent"
              >
                @{person.username}
                {person.displayName !== person.username && (
                  <span className="ml-2 font-normal text-muted-foreground">
                    {person.displayName}
                  </span>
                )}
              </Link>
              <IconButton
                icon="close"
                label={`Remove @${person.username} from ${group.name}`}
                onClick={() => onRemove(person)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RenameGroupDialog({
  group,
  onClose,
  onRename,
}: {
  group: GroupView;
  onClose: () => void;
  onRename: (name: string) => Promise<string | null>;
}) {
  const titleId = useId();
  const [name, setName] = useState(group.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || saving) return;
    if (trimmed === group.name) return onClose();
    setSaving(true);
    const failed = await onRename(trimmed);
    setSaving(false);
    if (failed) setError(failed);
    else onClose();
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Rename group"
      titleId={titleId}
      size="sm"
      onSubmit={submit}
      isSubmitting={saving}
      footer={
        <>
          <Button variant="cancel" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={!trimmed || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Field label="Name" error={error ?? undefined}>
        <Input
          autoFocus
          value={name}
          maxLength={GROUP_NAME_MAX}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </Field>
    </BaseModal>
  );
}

/** The people you follow, each ticked when they're in the group, saved as it's ticked. */
function AddPeopleDialog({
  userId,
  group,
  onClose,
  onToggle,
}: {
  userId: string;
  group: GroupView;
  onClose: () => void;
  onToggle: (person: GroupPerson, on: boolean) => Promise<void>;
}) {
  const titleId = useId();
  const [people, setPeople] = useState<FollowedPerson[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    fetch(`/api/users/${userId}/following`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((result) => {
        if (cancelled) return;
        if (!result?.success || !Array.isArray(result.data)) throw new Error('bad answer');
        setPeople(result.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const inGroup = useMemo(() => new Set(group.members.map((m) => m.id)), [group.members]);
  const full = group.members.length >= GROUP_MEMBER_LIMIT;
  // The following list carries usernames only; a display name is known (and
  // matched) for the people already in this group.
  const knownNames = useMemo(
    () => new Map(group.members.map((m) => [m.id, m.displayName])),
    [group.members]
  );
  const shown = (people ?? []).filter((p) =>
    personMatches({ username: p.username, displayName: knownNames.get(p._id) }, query)
  );

  async function toggle(p: FollowedPerson, on: boolean) {
    setBusy((b) => new Set(b).add(p._id));
    await onToggle(
      { id: p._id, username: p.username, displayName: p.username, image: p.image ?? null },
      on
    );
    setBusy((b) => {
      const next = new Set(b);
      next.delete(p._id);
      return next;
    });
  }

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`Add people to ${group.name}`}
      titleId={titleId}
      size="md"
      headerContent={
        people && people.length > 0 ? (
          <SearchField
            size="sm"
            aria-label="Search people you follow"
            placeholder="Search people you follow"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClear={() => setQuery('')}
          />
        ) : undefined
      }
      footer={
        <Button size="md" onClick={onClose}>
          Done
        </Button>
      }
    >
      {full && (
        <p className="mb-3 text-sm text-muted-foreground">
          {`A group can have up to ${GROUP_MEMBER_LIMIT} people.`}
        </p>
      )}
      {people === null && failed ? (
        <LoadError
          compact
          level={3}
          title="Couldn’t load who you follow"
          onRetry={() => setAttempt((n) => n + 1)}
        />
      ) : people === null ? (
        <div aria-hidden className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>
      ) : people.length === 0 ? (
        <EmptyState
          compact
          framed={false}
          tone="muted"
          icon="users"
          level={3}
          title="You don’t follow anyone yet"
          body="Only people you follow can be in your groups."
        />
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one you follow matches.</p>
      ) : (
        <fieldset className="-mx-3">
          <legend className="sr-only">People you follow</legend>
          {shown.map((p) => {
            const checked = inGroup.has(p._id);
            return (
              <label
                key={p._id}
                className={`${POPOVER_OPTION_ROW} cursor-pointer transition-colors hover:bg-muted`}
              >
                <input
                  type="checkbox"
                  className={CHECKBOX}
                  checked={checked}
                  disabled={busy.has(p._id) || (full && !checked)}
                  onChange={(e) => toggle(p, e.target.checked)}
                />
                <Avatar name={p.username} src={p.image} size="sm" />
                <span className="min-w-0 flex-1 truncate text-foreground">@{p.username}</span>
              </label>
            );
          })}
        </fieldset>
      )}
    </BaseModal>
  );
}

/** The groups' place while they're read: a group and New group. */
function GroupsBodySkeleton() {
  return (
    <div aria-hidden className="space-y-4">
      <Skeleton className="h-[4.5rem] w-full rounded-xl" />
      <div>
        <Skeleton className="mb-1.5 h-4 w-24" />
        <Skeleton className="h-11 w-full rounded-xl" />
      </div>
    </div>
  );
}

/** The Groups panel in the Settings page's skeleton. */
export function GroupsSettingsSkeleton() {
  return (
    <Panel className="mb-6">
      <Skeleton className="h-6 w-20" />
      <Skeleton className="mt-2 h-4 w-full" />
      <Skeleton className="mt-1.5 h-4 w-2/3" />
      <div className="mt-5">
        <GroupsBodySkeleton />
      </div>
    </Panel>
  );
}
