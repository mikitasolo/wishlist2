'use client';

import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import AddItemTile from '@/components/AddItemTile';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import BaseModal from '@/components/BaseModal';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import Field from '@/components/Field';
import Input from '@/components/Input';
import SegmentedControl from '@/components/SegmentedControl';
import WishlistItem from '@/components/WishlistItem';
import { ITEM_GRID_CLASSES } from '@/components/Skeleton';
import { FIELD_LABEL } from '@/components/fieldStyles';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import { parsePriceInput } from '@/lib/utils/currency';
import { applyGroupGiftAction, type GroupGiftAction } from '@/lib/utils/groupGiftClient';
import {
  newPracticeItem,
  PRACTICE_GROUP_GIFT_ID,
  PRACTICE_RESERVE_ID,
  practiceItems,
  type PracticeView,
} from '@/lib/utils/practiceList';
import { visibilityMeta, VISIBILITY_OPTIONS, type Visibility } from '@/lib/utils/visibility';
import type { ApiItem } from '@/types/api';

/**
 * The guided walkthrough's practice list (WIS-436): the real item cards over
 * made-up items (`practiceItems`), every action applied in memory only. It
 * sends no request and saves nothing, so the tour can let people really press
 * Reserve, start a group gift, add an item or open Share, whatever lists they
 * have. A friend's list at `/tour`, one of their own at `/tour/mine` (which,
 * as every owner's view, shows no reservation).
 */
export default function PracticeList({ view }: { view: PracticeView }) {
  const { data: session } = useKnownSession();
  const viewerId = session?.user?.id ?? 'practice-you';
  const isOwner = view === 'owner';
  const [items, setItems] = useState<ApiItem[]>(() => practiceItems(view));
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);

  // What's on screen, for the card's answer: an update resolves the item as it
  // now is (null would read as a failure, and play no moment). Every change
  // goes through it, then to the state.
  const shown = useRef(items);
  // Ids for added items: only ever goes up, so a delete never frees one.
  const added = useRef(0);

  const change = useCallback((id: string, edit: (item: ApiItem) => ApiItem) => {
    const before = shown.current.find((item) => item._id === id);
    if (!before) return null;
    const after = edit(before);
    shown.current = shown.current.map((item) => (item._id === id ? after : item));
    setItems(shown.current);
    return after;
  }, []);

  const update = useCallback(
    async (id: string, updates: Partial<ApiItem>) =>
      change(id, (item) => {
        const next = { ...item, ...updates };
        // A reservation is the viewer's own, a release clears it (a member's view only).
        if (!isOwner && updates.status === 'booked') next.bookedBy = viewerId;
        if (!isOwner && updates.status === 'available') next.bookedBy = null;
        return next;
      }),
    [change, isOwner, viewerId]
  );

  const groupGift = useCallback(
    async (id: string, action: GroupGiftAction) =>
      change(id, (item) => applyGroupGiftAction(item, action, viewerId)),
    [change, viewerId]
  );

  const remove = useCallback(async (item: ApiItem) => {
    shown.current = shown.current.filter((i) => i._id !== item._id);
    setItems(shown.current);
  }, []);

  const add = useCallback((name: string, cents: number | null) => {
    shown.current = [newPracticeItem(name, cents, added.current++), ...shown.current];
    setItems(shown.current);
    setAdding(false);
  }, []);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Callout tone="info" className="mb-6">
          <p>
            A practice list for the tour, with made-up items. Nothing you do here is saved or seen
            by anyone.
          </p>
          <Link href="/" className="mt-1 inline-block font-medium text-accent hover:underline">
            Back to Home
          </Link>
        </Callout>

        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {isOwner ? 'Your practice list' : 'Maya’s birthday'}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isOwner ? 'Only you can see it.' : 'A made-up friend’s list.'}
            </p>
          </div>
          {isOwner && (
            <Button
              variant="secondary"
              size="sm"
              icon="share"
              onClick={() => setSharing(true)}
              data-tour="share"
            >
              Share
            </Button>
          )}
        </header>

        <div className={ITEM_GRID_CLASSES}>
          {isOwner && (
            <AddItemTile label="Add item" onClick={() => setAdding(true)} data-tour="add-item" />
          )}
          {items.map((item) => (
            <WishlistItem
              key={item._id}
              item={item}
              onUpdate={update}
              onDelete={isOwner ? remove : undefined}
              onGroupGift={isOwner ? undefined : groupGift}
              isAuthenticated
              isOwner={isOwner}
              isMember={!isOwner}
              tourTargets={
                isOwner
                  ? undefined
                  : item._id === PRACTICE_RESERVE_ID
                    ? { primary: 'reserve' }
                    : item._id === PRACTICE_GROUP_GIFT_ID
                      ? { menu: 'group-gift' }
                      : undefined
              }
            />
          ))}
        </div>
      </main>

      {adding && <PracticeAddDialog onAdd={add} onClose={() => setAdding(false)} />}
      {sharing && <PracticeShareDialog onClose={() => setSharing(false)} />}
    </div>
  );
}

function PracticeAddDialog({
  onAdd,
  onClose,
}: {
  onAdd: (name: string, cents: number | null) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const parsed = parsePriceInput(price);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim() || !parsed.ok) return;
    onAdd(name.trim(), parsed.cents);
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Add item"
      titleId={titleId}
      size="sm"
      onSubmit={submit}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim() || !parsed.ok}>
            Add item
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          On a real list you can also paste a link, and the name, price and photo fill in.
        </p>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label="Price" error={parsed.ok ? undefined : 'Enter an amount, like 25 or 24.99.'}>
          <Input value={price} onChange={(e) => setPrice(e.target.value)} leading="$" />
        </Field>
      </div>
    </BaseModal>
  );
}

function PracticeShareDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const labelId = useId();
  const helperId = useId();
  const [visibility, setVisibility] = useState<Visibility>('friends');
  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title="Share your list"
      titleId={titleId}
      size="sm"
      footer={<Button onClick={onClose}>Done</Button>}
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          On a real list, Share copies its link, and you can invite people by username.
        </p>
        <div>
          <span id={labelId} className={FIELD_LABEL}>
            Who can see it
          </span>
          <p id={helperId} className="mb-1.5 text-xs text-muted-foreground">
            {visibilityMeta[visibility].helper}
          </p>
          <SegmentedControl
            ariaLabelledBy={labelId}
            ariaDescribedBy={helperId}
            value={visibility}
            onChange={setVisibility}
            options={VISIBILITY_OPTIONS}
          />
        </div>
      </div>
    </BaseModal>
  );
}
