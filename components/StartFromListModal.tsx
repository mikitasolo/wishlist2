'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import BaseModal from './BaseModal';
import Button from './Button';
import Avatar from './Avatar';
import Badge from './Badge';
import Cover from './Cover';
import Field from './Field';
import Icon from './Icon';
import Input from './Input';
import LoadError from './LoadError';
import OccasionField from './OccasionField';
import SegmentedControl from './SegmentedControl';
import Select from './Select';
import { Skeleton } from './Skeleton';
import { FIELD_HELPER, FIELD_LABEL } from './fieldStyles';
import { useToast } from './ToastProvider';
import { ARCHIVE_EXPLANATION } from './WishlistSettingsTab';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { readResource } from '@/lib/utils/resourceRead';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';
import { createSubmissionKeys, IDEMPOTENCY_HEADER } from '@/lib/utils/submissionKey';
import { plural } from '@/lib/utils/plural';
import { publicDisplayName } from '@/lib/utils/displayName';
import { statusMeta } from '@/lib/utils/itemStatus';
import { visibilityMeta, VISIBILITY_OPTIONS, type Visibility } from '@/lib/utils/visibility';
import {
  draftToOccasion,
  missingFromDraft,
  occasionToDraft,
  type Occasion,
  type OccasionDraft,
} from '@/lib/utils/occasion';
import {
  COPY_ITEMS_MAX,
  reinviteCandidates,
  type CopyCandidate,
  type ReinviteCandidate,
  type SourcePerson,
} from '@/lib/utils/wishlistCopy';

/** What `GET /api/wishlists/[id]/copy` answers. */
interface CopySource {
  name: string;
  visibility: Visibility;
  occasion: Occasion | null;
  archived: boolean;
  items: CopyCandidate[];
}

/** The new list, as the copy answers it. */
interface NewList {
  _id: string;
  name: string;
  slug?: string | null;
}

type Read<T> =
  { state: 'loading' } | { state: 'failed' } | { state: 'refused' } | { state: 'loaded'; data: T };

/** Copying images can take a while: longer than an item's save. */
const COPY_REQUEST_TIMEOUT_MS = 60_000;

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'owner', label: 'Owner' },
];

/** What came of one person's invite: sent, or the route's error. */
type InviteResult = { ok: true } | { ok: false; error: string };

interface StartFromListModalProps {
  /** The list to start from: one the viewer owns (archived ones included). */
  sourceId: string;
  isOpen: boolean;
  /** Closed before the list exists: nothing was made. */
  onClose: () => void;
}

/**
 * "Start a new list from this one" (WIS-325), in three steps:
 *
 * 1. The new list: its name (the old one's, to edit), occasion (a yearly one
 *    kept, a one-off one left to pick) and visibility, and which of the old
 *    list's items to bring over (none picked to start with). Description,
 *    cover and currency come along. Owners are booking-blind, so the picker
 *    shows nothing about reservations: received items and proposals waiting
 *    for review are simply not offered.
 * 2. Its people: the old list's co-owners and members, all ticked, each with
 *    their old role to change; each gets a normal invite, which they must
 *    accept, and a refusal is shown on that person's row.
 * 3. The old list: offered to be archived, never archived unasked (skipped when
 *    it already is).
 *
 * Then it goes to the new list, as closing it does once the list exists.
 * Opened by the list's Settings, and by anything else holding the id of a list
 * the viewer owns.
 */
export default function StartFromListModal({ sourceId, isOpen, onClose }: StartFromListModalProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const { data: session } = useKnownSession();
  const selfId = session?.user?.id ?? '';

  const [source, setSource] = useState<Read<CopySource>>({ state: 'loading' });
  const [name, setName] = useState('');
  const [occasion, setOccasion] = useState<OccasionDraft>(occasionToDraft(null));
  const [visibility, setVisibility] = useState<Visibility>('everyone');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<NewList | null>(null);
  const [step, setStep] = useState<'details' | 'people' | 'archive'>('details');
  const keys = useRef(createSubmissionKeys());

  const visibilityLabelId = useId();
  const visibilityHelperId = useId();
  const itemsLabelId = useId();

  const loadSource = useCallback(async () => {
    setSource({ state: 'loading' });
    const read = await readResource<CopySource>(`/api/wishlists/${sourceId}/copy`);
    if (read.outcome !== 'loaded') {
      setSource({ state: read.outcome });
      return;
    }
    const data = read.data;
    setSource({ state: 'loaded', data });
    setName(data.name);
    setOccasion(occasionToDraft(data.occasion));
    setVisibility(data.visibility);
    setPicked(new Set());
  }, [sourceId]);

  useEffect(() => {
    if (!isOpen) return;
    setCreated(null);
    setStep('details');
    keys.current.reset();
    void loadSource();
  }, [isOpen, loadSource]);

  const finish = useCallback(
    (list: NewList) => {
      onClose();
      router.push(`/wishlists/${list.slug ?? list._id}`);
    },
    [onClose, router]
  );

  // Once the list exists, closing goes to it: there's nothing to throw away.
  const close = () => (created ? finish(created) : onClose());

  const loaded = source.state === 'loaded' ? source.data : null;
  const items = loaded?.items ?? [];
  const tooMany = picked.size > COPY_ITEMS_MAX;

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loaded || submitting) return;
    const missing = missingFromDraft(occasion);
    if (missing) {
      showToast(missing, 'error');
      return;
    }
    if (tooMany) return;
    const payload = {
      name,
      visibility,
      occasion: draftToOccasion(occasion),
      // In the order the picker shows them; the server copies them in the old list's.
      itemIds: items.filter((i) => picked.has(i._id)).map((i) => i._id),
    };
    setSubmitting(true);
    try {
      const result = await withRequestTimeout(async (signal) => {
        const res = await fetch(`/api/wishlists/${sourceId}/copy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [IDEMPOTENCY_HEADER]: keys.current.keyFor(payload),
          },
          body: JSON.stringify(payload),
          signal,
        });
        return (await res.json()) as {
          success: boolean;
          data?: NewList;
          error?: string;
          notice?: string;
        };
      }, COPY_REQUEST_TIMEOUT_MS);
      if (!result.success || !result.data) {
        showToast(result.error || 'Failed to create wishlist', 'error');
        return;
      }
      keys.current.reset();
      setCreated(result.data);
      showToast(
        result.notice ?? `“${result.data.name}” is ready`,
        result.notice ? 'info' : 'success'
      );
      setStep('people');
    } catch (error) {
      showToast(
        error instanceof Error && error.name === 'RequestTimeoutError'
          ? error.message
          : 'Failed to create wishlist',
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const afterPeople = () => {
    if (!created) return;
    if (loaded && !loaded.archived) setStep('archive');
    else finish(created);
  };

  if (step === 'people' && created) {
    return (
      <PeopleStep
        isOpen={isOpen}
        sourceId={sourceId}
        selfId={selfId}
        list={created}
        onClose={close}
        onDone={afterPeople}
      />
    );
  }

  if (step === 'archive' && created && loaded) {
    return (
      <ArchiveStep
        isOpen={isOpen}
        sourceId={sourceId}
        sourceName={loaded.name}
        onDone={() => finish(created)}
      />
    );
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={close}
      title="Start a new list"
      titleId="start-from-list-title"
      size="lg"
      onSubmit={submit}
      isSubmitting={submitting}
      footer={
        <>
          <Button variant="secondary" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={!loaded || submitting || tooMany}>
            {submitting ? 'Creating…' : 'Create list'}
          </Button>
        </>
      }
    >
      {source.state === 'loading' && <DetailsSkeleton />}
      {source.state === 'failed' && (
        <LoadError compact level={3} title="Couldn’t load this wishlist" onRetry={loadSource} />
      )}
      {source.state === 'refused' && (
        <p className="text-sm text-muted-foreground">
          This wishlist isn’t available. Only its owners can start a new list from it.
        </p>
      )}
      {loaded && (
        <div className="space-y-4">
          <Field label="Wishlist name *" id="start-from-list-name">
            <Input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              aria-required="true"
              autoComplete="off"
            />
          </Field>

          <OccasionField value={occasion} onChange={setOccasion} disabled={submitting} />

          <div>
            <span id={visibilityLabelId} className={FIELD_LABEL}>
              Visibility
            </span>
            <p id={visibilityHelperId} className="mb-1.5 text-xs text-muted-foreground">
              {visibilityMeta[visibility].helper}
            </p>
            <SegmentedControl
              ariaLabelledBy={visibilityLabelId}
              ariaDescribedBy={visibilityHelperId}
              value={visibility}
              onChange={setVisibility}
              disabled={submitting}
              options={VISIBILITY_OPTIONS}
            />
          </div>

          <p className={FIELD_HELPER}>
            Its description, cover photo and currency come along too. “{loaded.name}” stays as it
            is.
          </p>

          <fieldset aria-labelledby={itemsLabelId} disabled={submitting}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span id={itemsLabelId} className={FIELD_LABEL + ' mb-0'}>
                Items to bring over
              </span>
              {items.length > 0 && (
                <button
                  type="button"
                  className="rounded-md text-sm font-medium text-accent"
                  onClick={() =>
                    setPicked(
                      picked.size === items.length ? new Set() : new Set(items.map((i) => i._id))
                    )
                  }
                >
                  {picked.size === items.length ? 'Clear' : 'Pick all'}
                </button>
              )}
            </div>
            <p className="mb-2 text-xs text-muted-foreground">
              Copies start with nobody’s reservation. Received items and proposals waiting for
              review aren’t offered.
            </p>
            {items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                No items to bring over.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {items.map((item) => (
                  <li key={item._id}>
                    <label className="flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2">
                      <input
                        type="checkbox"
                        className="size-4 flex-shrink-0 accent-primary-600"
                        checked={picked.has(item._id)}
                        onChange={() => toggle(item._id)}
                      />
                      <Cover
                        src={item.imageUrl}
                        seed={item._id}
                        sizes="40px"
                        className="size-10 flex-shrink-0 rounded-lg"
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                        {item.name}
                      </span>
                      {item.mostWanted && (
                        <Icon
                          name="star"
                          size={16}
                          className="flex-shrink-0 fill-star text-star-edge"
                          aria-label="Most wanted"
                        />
                      )}
                      {item.draft && <Badge size="sm" status={statusMeta('draft', 'owner')} />}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {items.length > 0 && (
              <p className={FIELD_HELPER} aria-live="polite">
                {tooMany
                  ? `Pick at most ${COPY_ITEMS_MAX} items.`
                  : `${plural(picked.size, 'item')} picked`}
              </p>
            )}
          </fieldset>
        </div>
      )}
    </BaseModal>
  );
}

function DetailsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-9 w-2/3 rounded-xl" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

/** Step 2: invite the old list's people to the new one. */
function PeopleStep({
  isOpen,
  sourceId,
  selfId,
  list,
  onClose,
  onDone,
}: {
  isOpen: boolean;
  sourceId: string;
  selfId: string;
  list: NewList;
  onClose: () => void;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [people, setPeople] = useState<Read<ReinviteCandidate[]>>({ state: 'loading' });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [roles, setRoles] = useState<Record<string, 'owner' | 'member'>>({});
  const [results, setResults] = useState<Record<string, InviteResult>>({});
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setPeople({ state: 'loading' });
    const read = await readResource<SourcePerson[]>(`/api/wishlists/${sourceId}/members`);
    if (read.outcome !== 'loaded') {
      setPeople({ state: read.outcome });
      return;
    }
    const candidates = reinviteCandidates(read.data, selfId);
    setPeople({ state: 'loaded', data: candidates });
    // Everyone, as they were: one click invites them all.
    setChecked(new Set(candidates.map((c) => c.userId)));
    setRoles(Object.fromEntries(candidates.map((c) => [c.userId, c.role])));
  }, [sourceId, selfId]);

  // Only once the session says who the starter is: they're never offered to
  // themselves (it shows loading until then).
  useEffect(() => {
    if (selfId) void load();
  }, [load, selfId]);

  const candidates = people.state === 'loaded' ? people.data : [];
  // Nobody else was on the list: nothing to ask. Once only, whatever re-renders.
  const skipped = useRef(false);
  useEffect(() => {
    if (skipped.current || people.state !== 'loaded' || people.data.length > 0) return;
    skipped.current = true;
    onDone();
  }, [people, onDone]);

  const pending = candidates.filter((c) => checked.has(c.userId) && !results[c.userId]?.ok);
  const anyInvited = Object.values(results).some((r) => r.ok);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending || pending.length === 0) return;
    setSending(true);
    const next: Record<string, InviteResult> = { ...results };
    // One at a time, each through the invite route every invite takes: its
    // checks, its consent (an owner invite must be accepted) and its limits.
    for (const person of pending) {
      try {
        const res = await fetch(`/api/wishlists/${list._id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: person.username, role: roles[person.userId] }),
        });
        const body = (await res.json().catch(() => null)) as {
          success?: boolean;
          error?: string;
        } | null;
        next[person.userId] = body?.success
          ? { ok: true }
          : { ok: false, error: body?.error || 'Couldn’t invite them' };
      } catch {
        next[person.userId] = { ok: false, error: 'Couldn’t invite them' };
      }
      setResults({ ...next });
    }
    setSending(false);
    const failed = pending.filter((p) => !next[p.userId]?.ok).length;
    if (failed === 0) {
      showToast(`${plural(pending.length, 'invitation')} sent`, 'success');
      onDone();
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Invite people again"
      titleId="start-from-list-people-title"
      size="lg"
      onSubmit={invite}
      busy={sending}
      footer={
        <>
          <Button variant="secondary" onClick={onDone} disabled={sending}>
            {anyInvited ? 'Continue' : 'Skip'}
          </Button>
          <Button type="submit" disabled={sending || pending.length === 0}>
            {sending ? 'Inviting…' : `Invite ${plural(pending.length, 'person', 'people')}`}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        These people were on the old list. Each gets an invitation to “{list.name}”, and joins once
        they accept it.
      </p>
      {people.state === 'loading' && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      )}
      {people.state === 'failed' && (
        <LoadError compact level={3} title="Couldn’t load its people" onRetry={load} />
      )}
      {people.state === 'refused' && (
        <p className="text-sm text-muted-foreground">
          You can no longer see who was on the old list.
        </p>
      )}
      {candidates.length > 0 && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {candidates.map((person) => {
            const result = results[person.userId];
            const done = result?.ok === true;
            const label = publicDisplayName({ username: person.username });
            return (
              <li
                key={person.userId}
                className="flex min-h-14 flex-wrap items-center gap-3 px-3 py-2"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4 flex-shrink-0 accent-primary-600"
                    checked={checked.has(person.userId)}
                    disabled={sending || done}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(person.userId)) next.delete(person.userId);
                        else next.add(person.userId);
                        return next;
                      })
                    }
                  />
                  <Avatar name={label} src={person.image} size="sm" />
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    @{label}
                  </span>
                </label>
                {done ? (
                  <span className="flex items-center gap-1 text-sm text-success">
                    <Icon name="check" size={16} />
                    Invited
                  </span>
                ) : (
                  <Select
                    size="sm"
                    value={roles[person.userId] ?? person.role}
                    onChange={(v) =>
                      setRoles((prev) => ({ ...prev, [person.userId]: v as 'owner' | 'member' }))
                    }
                    options={ROLE_OPTIONS}
                    ariaLabel={`Role for @${label}`}
                    disabled={sending || !checked.has(person.userId)}
                    menuAlign="right"
                  />
                )}
                {result && !result.ok && (
                  <p className="w-full text-xs text-danger" role="alert">
                    {result.error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </BaseModal>
  );
}

/** Step 3: offer to archive the old list. */
function ArchiveStep({
  isOpen,
  sourceId,
  sourceName,
  onDone,
}: {
  isOpen: boolean;
  sourceId: string;
  sourceName: string;
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [archiving, setArchiving] = useState(false);

  const archive = async () => {
    setArchiving(true);
    try {
      const res = await fetch(`/api/wishlists/${sourceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      const body = (await res.json().catch(() => null)) as {
        success?: boolean;
        error?: string;
      } | null;
      if (body?.success) {
        showToast(`“${sourceName}” archived`, 'success');
        onDone();
        return;
      }
      // Stays open, so Archive can be tried again (or the list kept).
      showToast(body?.error || 'Failed to archive wishlist', 'error');
    } catch {
      showToast('Failed to archive wishlist', 'error');
    }
    setArchiving(false);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onDone}
      title={`Archive “${sourceName}”?`}
      titleId="start-from-list-archive-title"
      size="md"
      isSubmitting={archiving}
      footer={
        <>
          <Button variant="secondary" onClick={onDone} disabled={archiving}>
            Keep it
          </Button>
          <Button icon="archive" onClick={archive} disabled={archiving}>
            {archiving ? 'Archiving…' : 'Archive'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Your new list is ready. You can archive the old one now, or keep it as it is.{' '}
        {ARCHIVE_EXPLANATION}
      </p>
    </BaseModal>
  );
}
