'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import BaseModal from './BaseModal';
import Button from './Button';
import LoadError from './LoadError';
import NewGroupForm from './NewGroupForm';
import { Skeleton } from './Skeleton';
import { useToast } from './ToastProvider';
import { buttonClassName } from './buttonStyles';
import { POPOVER_OPTION_ROW } from './popoverStyles';
import { usePeopleGroups, type GroupPerson } from '@/lib/hooks/usePeopleGroups';
import { groupLimitNote } from '@/lib/utils/groupRules';

interface TagIntoGroupsProps {
  /** The person whose profile this is: someone the viewer follows. */
  person: GroupPerson;
}

const CHECKBOX = 'h-4 w-4 flex-shrink-0 cursor-pointer accent-primary-600';

/**
 * Tag into groups, on the profile of someone you follow (WIS-27): a dialog of
 * your groups, each ticked when they're in it, saved as it's ticked, and a New
 * group that tags them into it. Nobody but you sees any of it.
 */
export default function TagIntoGroups({ person }: TagIntoGroupsProps) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const { showToast } = useToast();
  const { groups, failed, retry, create, setTagged } = usePeopleGroups(open);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const name = person.username ? `@${person.username}` : person.displayName;

  async function toggle(groupId: string, on: boolean) {
    setBusy((b) => new Set(b).add(groupId));
    const error = await setTagged(groupId, person, on);
    setBusy((b) => {
      const next = new Set(b);
      next.delete(groupId);
      return next;
    });
    if (error) showToast(error, 'error');
  }

  async function createAndTag(groupName: string): Promise<string | null> {
    const made = await create(groupName);
    if ('error' in made) return made.error;
    // A new group from here is for this person: tag them straight in.
    const error = await setTagged(made.group.id, person, true);
    if (error) showToast(error, 'error');
    return null;
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        shape="pill"
        icon="tag"
        onClick={() => setOpen(true)}
        aria-label={`Tag ${name} into groups`}
      >
        Groups
      </Button>
      <BaseModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title={`Tag ${name} into groups`}
        titleId={titleId}
        size="md"
        footer={
          <>
            <Link
              href="/settings#groups"
              className={buttonClassName({ variant: 'ghost', size: 'md' })}
            >
              Manage groups
            </Link>
            <Button size="md" onClick={() => setOpen(false)}>
              Done
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-muted-foreground">
          Only you can see your groups. {name} isn’t told.
        </p>
        {groups === null && failed ? (
          <LoadError compact level={3} title="Couldn’t load your groups" onRetry={retry} />
        ) : groups === null ? (
          <div aria-hidden className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <>
            {groups.length > 0 ? (
              <fieldset className="-mx-3 mb-5">
                <legend className="sr-only">Groups</legend>
                {groups.map((g) => {
                  const checked = g.members.some((m) => m.id === person.id);
                  return (
                    <label
                      key={g.id}
                      className={`${POPOVER_OPTION_ROW} cursor-pointer transition-colors hover:bg-muted`}
                    >
                      <input
                        type="checkbox"
                        className={CHECKBOX}
                        checked={checked}
                        disabled={busy.has(g.id)}
                        onChange={(e) => toggle(g.id, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1 truncate text-foreground">{g.name}</span>
                    </label>
                  );
                })}
              </fieldset>
            ) : (
              <p className="mb-5 text-sm text-foreground">
                You have no groups yet. Make one for {name}:
              </p>
            )}
            <NewGroupForm
              size="sm"
              onCreate={createAndTag}
              atLimit={groupLimitNote(groups.length)}
            />
          </>
        )}
      </BaseModal>
    </>
  );
}
