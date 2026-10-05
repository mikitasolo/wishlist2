'use client';

import { useId, useState, type FormEvent } from 'react';
import BaseModal from '@/components/BaseModal';
import Badge from '@/components/Badge';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import Field from '@/components/Field';
import Input from '@/components/Input';
import SegmentedControl from '@/components/SegmentedControl';
import Select from '@/components/Select';
import { FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';
import { addDays, localDateString, type Occasion } from '@/lib/utils/occasion';
import { SHARE_LINK_LABEL_MAX, type ShareLinkLevel } from '@/lib/utils/shareLinkFields';
import {
  dayAfterOccasion,
  defaultExpiryPreset,
  defaultLevel,
  expiryDateString,
  expiryFor,
  expiryPresetsFor,
  isRevival,
  SHARE_LINK_EXPIRY_LABELS,
  type ShareLinkExpiryPreset,
} from '@/lib/utils/shareLinkExpiry';
import type { Visibility } from '@/lib/utils/visibility';
import {
  browserTimeZone,
  type NewShareLink,
  type ShareLinkPatch,
  type ShareLinkRow,
} from '@/lib/hooks/useShareLinks';

/** What each level lets a link's holder do, under the level control. */
export const SHARE_LINK_LEVEL_HELPERS: Record<ShareLinkLevel, string> = {
  view: 'People can see the list and ask to join.',
  join: 'People can join the list and reserve gifts, without asking.',
};

/** Said under View on a Public list, whose canonical URL already opens for anyone. */
export const PUBLIC_VIEW_LINK_NOTE =
  'Anyone can already open this list. A view link keeps working if you rename it.';

/** Said in Edit when the new expiry brings an expired link back. */
export const REVIVAL_WARNING = 'This link will work again for everyone who has it.';

export const SHARE_LINK_LEVEL_LABELS: Record<ShareLinkLevel, string> = {
  view: 'Can view',
  join: 'Can join',
};

const LEVEL_OPTIONS = [
  { value: 'view' as const, label: 'View' },
  { value: 'join' as const, label: 'Join' },
];

type ShareLinkDialogProps = {
  visibility: Visibility;
  occasion?: Occasion | null;
  onClose: () => void;
  /** The moment the dialog counts from (tests); the current time by default. */
  now?: Date;
} & (
  | {
      mode: 'create';
      link?: never;
      /** Resolves true once the link exists, which closes the dialog. */
      onCreate: (input: NewShareLink) => Promise<boolean>;
      onUpdate?: never;
    }
  | {
      mode: 'edit';
      link: ShareLinkRow;
      onCreate?: never;
      /** Gets only the fields changed; resolves true once saved, which closes the dialog. */
      onUpdate: (id: string, patch: ShareLinkPatch) => Promise<boolean>;
    }
);

/**
 * New link and Edit link, for a list's owners (WIS-335). New link picks the
 * level (View or Join, fixed once made), a label only owners see, and when it
 * stops working, from presets whose defaults follow the level
 * (`defaultExpiryPreset`). Edit changes the label and expiry only, sends only
 * what changed, and warns when the new expiry brings an expired link back.
 */
export default function ShareLinkDialog(props: ShareLinkDialogProps) {
  const { visibility, occasion, onClose, mode } = props;
  const editing = mode === 'edit' ? props.link : null;
  const [now] = useState(() => props.now ?? new Date());
  const [today] = useState(() => localDateString(now));
  const hasOccasion = dayAfterOccasion(occasion, today) !== null;
  const presets = expiryPresetsFor(occasion, today);

  const initialLevel = editing ? editing.level : defaultLevel(visibility);
  const [level, setLevel] = useState<ShareLinkLevel>(initialLevel);
  const [label, setLabel] = useState(editing?.label ?? '');
  // A link made with Day after the occasion opens on it, while there's one
  // ahead (WIS-342); any other dated link on Custom.
  const initialPreset: ShareLinkExpiryPreset = editing
    ? editing.untilOccasion && hasOccasion
      ? 'occasion'
      : editing.expiresAt
        ? 'custom'
        : 'never'
    : defaultExpiryPreset(initialLevel, hasOccasion);
  const [preset, setPreset] = useState<ShareLinkExpiryPreset>(initialPreset);
  const [customDate, setCustomDate] = useState(
    editing?.expiresAt ? expiryDateString(editing.expiresAt) : ''
  );
  // Once the owner picks an expiry, a change of level leaves it alone; and in
  // Edit, an expiry they never touched isn't sent.
  const [expiryTouched, setExpiryTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);

  const ids = {
    title: useId(),
    level: useId(),
    levelHelper: useId(),
    expiry: useId(),
    date: useId(),
  };

  const chooseLevel = (next: ShareLinkLevel) => {
    setLevel(next);
    if (!expiryTouched) setPreset(defaultExpiryPreset(next, hasOccasion));
  };
  const choosePreset = (next: string) => {
    setPreset(next as ShareLinkExpiryPreset);
    setExpiryTouched(true);
    setDateError(null);
  };

  // `undefined`: no valid expiry yet (a Custom date still to pick).
  // A stored expiry is any moment (a preset's is a week or a month from when it
  // was set), shown as its day: picking that same day again keeps the moment,
  // rather than moving it to that day's midnight.
  const keepsStoredDay =
    !!editing?.expiresAt &&
    preset === 'custom' &&
    customDate === expiryDateString(editing.expiresAt);
  const expiresAt = keepsStoredDay
    ? editing!.expiresAt
    : expiryFor(preset, { now, today, occasion, customDate });
  const revival =
    !!editing && expiryTouched && expiresAt !== undefined && isRevival(editing, expiresAt, now);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (expiresAt === undefined && (!editing || expiryTouched)) {
      setDateError('Pick a date after today.');
      return;
    }
    const trimmed = label.trim();
    setSubmitting(true);
    let done: boolean;
    if (props.mode === 'create') {
      done = await props.onCreate({
        level,
        label: trimmed || null,
        expiresAt: expiresAt ?? null,
        ...(preset === 'occasion'
          ? { untilOccasion: true as const, timeZone: browserTimeZone() }
          : {}),
      });
    } else {
      const patch: ShareLinkPatch = {};
      if (trimmed !== (props.link.label ?? '')) patch.label = trimmed || null;
      if (expiryTouched && expiresAt !== undefined) {
        const untilOccasion = preset === 'occasion';
        // The same date picked another way still changes whether it follows
        // the occasion: the expiry goes, and Day after the occasion says so.
        if (expiresAt !== props.link.expiresAt || untilOccasion !== !!props.link.untilOccasion) {
          patch.expiresAt = expiresAt;
          if (untilOccasion) {
            patch.untilOccasion = true;
            patch.timeZone = browserTimeZone();
          }
        }
      }
      // Nothing changed: nothing to send.
      done = Object.keys(patch).length === 0 ? true : await props.onUpdate(props.link._id, patch);
    }
    setSubmitting(false);
    if (done) onClose();
  }

  const title = editing ? 'Edit link' : 'New link';

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={title}
      titleId={ids.title}
      size="md"
      onSubmit={handleSubmit}
      isSubmitting={submitting}
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting}>
            {editing
              ? submitting
                ? 'Saving…'
                : 'Save changes'
              : submitting
                ? 'Creating…'
                : 'Create link'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p id={ids.level} className={FIELD_LABEL}>
            Level
          </p>
          {editing ? (
            <>
              <Badge tone={editing.level === 'join' ? 'info' : 'neutral'}>
                {SHARE_LINK_LEVEL_LABELS[editing.level]}
              </Badge>
              <p className={FIELD_HELPER}>
                {SHARE_LINK_LEVEL_HELPERS[editing.level]} To change it, make a new link.
              </p>
            </>
          ) : (
            <>
              <SegmentedControl
                ariaLabelledBy={ids.level}
                ariaDescribedBy={ids.levelHelper}
                value={level}
                onChange={chooseLevel}
                disabled={submitting}
                options={LEVEL_OPTIONS}
              />
              <p id={ids.levelHelper} className={FIELD_HELPER}>
                {SHARE_LINK_LEVEL_HELPERS[level]}
                {level === 'view' && visibility === 'everyone' && ` ${PUBLIC_VIEW_LINK_NOTE}`}
              </p>
            </>
          )}
        </div>

        <Field label="Label" helper="Only owners see it, to tell your links apart.">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={SHARE_LINK_LABEL_MAX}
            placeholder="Family chat"
            disabled={submitting}
          />
        </Field>

        <div>
          <p id={ids.expiry} className={FIELD_LABEL}>
            Expires
          </p>
          <Select
            ariaLabel="Expires"
            value={preset}
            onChange={choosePreset}
            disabled={submitting}
            triggerClassName="w-full"
            options={presets.map((p) => ({ value: p, label: SHARE_LINK_EXPIRY_LABELS[p] }))}
          />
        </div>

        {preset === 'custom' && (
          <Field label="Expiry date" error={dateError} helper="The link stops working on this day.">
            <Input
              type="date"
              value={customDate}
              min={addDays(today, 1) ?? undefined}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setExpiryTouched(true);
                setDateError(null);
              }}
              disabled={submitting}
            />
          </Field>
        )}
        {preset !== 'custom' && dateError && (
          <p className="text-sm text-danger" role="alert">
            {dateError}
          </p>
        )}

        {revival && <Callout tone="warning">{REVIVAL_WARNING}</Callout>}
      </div>
    </BaseModal>
  );
}
