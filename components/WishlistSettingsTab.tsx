'use client';

import type { FormEvent, ReactNode } from 'react';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import Field from '@/components/Field';
import ImageUpload from '@/components/ImageUpload';
import Input from '@/components/Input';
import OccasionField from '@/components/OccasionField';
import Panel, { PanelRow } from '@/components/Panel';
import SegmentedControl from '@/components/SegmentedControl';
import Select from '@/components/Select';
import Textarea from '@/components/Textarea';
import { FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';
import { currencySelectOptions } from '@/lib/utils/currencies';
import { DELETE_LIST_WARNING } from '@/lib/utils/confirmationCopy';
import { VISIBILITY_OPTIONS, visibilityMeta } from '@/lib/utils/visibility';
import { shareLinksAudienceText } from '@/lib/utils/shareLink';
import type { WishlistSettings, WishlistSettingsForm } from '@/lib/utils/wishlistSettings';
import type { FreshUploads } from '@/lib/utils/freshUploads';

/**
 * What archiving does, where it's offered and again when it's confirmed. An
 * archived list is owner-only: everyone else gets the answer a missing list
 * gets, so a link already shared stops working for them.
 */
export const ARCHIVE_EXPLANATION =
  "Only owners can open it. Members and anyone with the link will see that it isn't available. Items and reservations are kept, and you can unarchive anytime.";

/** Under the link while it's been changed. */
export const SLUG_CHANGE_WARNING = "Changing it breaks links you've already shared.";

interface WishlistSettingsTabProps {
  form: WishlistSettingsForm;
  /** The list's settings as the form was last filled from them. */
  saved: WishlistSettings;
  /** The form differs from `saved`: a save would send something. */
  dirty: boolean;
  saving: boolean;
  onEdit: (change: Partial<WishlistSettingsForm>) => void;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** Puts the form back as it was last filled. */
  onDiscard: () => void;
  /** The page's unsaved cover photo uploads (`useFreshUploads`). */
  uploads?: FreshUploads;
  archived: boolean;
  archiving: boolean;
  /** Archive: asks first. */
  onArchive: () => void;
  /** Unarchive: only gives back the access people had, so it isn't asked about. */
  onUnarchive: () => void;
  deleting: boolean;
  /** Delete: asks first. */
  onDelete: () => void;
  /** How many of the list's share links work now: they open it whatever its visibility. */
  liveLinkCount?: number;
  /** How many of those end the day after the occasion, and so move with it (WIS-342). */
  occasionLinkCount?: number;
  /** Start a new list from this one (WIS-325): opens its dialog. */
  onStartNew?: () => void;
}

/** What "Start a new list from this one" does, under its title in Settings. */
export const START_NEW_LIST_TEXT =
  'Make a new list with its settings and the items you pick, then invite its people again. This list stays as it is.';

/** Under the occasion while some live links end the day after it (WIS-342). */
export const OCCASION_LINKS_NOTE =
  'Share links set to end the day after the occasion move with it.';

/**
 * The Settings tab of a list's page (owners only), in five sections:
 *
 * 1. About: name, description, occasion, cover photo.
 * 2. Who can see it: the visibility, its helper under the control.
 * 3. Advanced: the currency, and the link, which warns once it's changed.
 * 4. Next occasion: Start a new list from this one (WIS-325), in its own dialog.
 * 5. Danger zone: Archive and Delete, which act at once (each confirmed),
 *    apart from the form.
 *
 * The first three are one form. While it differs from the list as last filled
 * (`dirty`), a bar sticks to the bottom of the screen with Discard and Save;
 * otherwise there's nothing to save, and no Save. What a save sends is the
 * page's business (`settingsChanges`). Pin to my dashboard isn't a setting of
 * the list: it's in the title's ⋯ menu.
 */
export default function WishlistSettingsTab({
  form,
  saved,
  dirty,
  saving,
  onEdit,
  onSubmit,
  onDiscard,
  uploads,
  archived,
  archiving,
  onArchive,
  onUnarchive,
  deleting,
  onDelete,
  liveLinkCount = 0,
  occasionLinkCount = 0,
  onStartNew,
}: WishlistSettingsTabProps) {
  // Share links open the list whatever its visibility (WIS-335).
  // An archived list's links are all dead until it's unarchived.
  const linksText = archived ? null : shareLinksAudienceText(liveLinkCount);
  const slugChanged = form.slug.trim().toLowerCase() !== saved.slug.trim().toLowerCase();
  return (
    <div className="max-w-3xl space-y-6">
      <form onSubmit={onSubmit} className="space-y-6" autoComplete="off">
        <Panel title="About">
          <div className="space-y-4">
            <Field label="Wishlist name *" id="settings-name">
              <Input
                required
                value={form.name}
                onChange={(e) => onEdit({ name: e.target.value })}
                disabled={saving}
                autoComplete="off"
              />
            </Field>

            <Field label="Description" id="settings-description">
              <Textarea
                value={form.description}
                onChange={(e) => onEdit({ description: e.target.value })}
                rows={3}
                disabled={saving}
                autoComplete="off"
              />
            </Field>

            <OccasionField
              value={form.occasion}
              saved={saved.occasion}
              onChange={(occasion) => onEdit({ occasion })}
              disabled={saving}
            />
            {occasionLinkCount > 0 && !archived && (
              <p className="-mt-2.5 text-xs text-muted-foreground">{OCCASION_LINKS_NOTE}</p>
            )}

            <div>
              <label className={FIELD_LABEL}>
                Cover photo <span className="text-muted-foreground">(optional)</span>
              </label>
              <ImageUpload
                value={form.bannerUrl || null}
                onChange={(url) => onEdit({ bannerUrl: url ?? '' })}
                uploads={uploads}
                disabled={saving}
              />
              <p className={FIELD_HELPER}>Shown across the top of the list, and on its card.</p>
            </div>
          </div>
        </Panel>

        <Panel title="Who can see it" titleId="settings-visibility-label">
          <SegmentedControl
            ariaLabelledBy="settings-visibility-label"
            ariaDescribedBy="settings-visibility-helper"
            value={form.visibility}
            onChange={(visibility) => onEdit({ visibility })}
            disabled={saving}
            options={VISIBILITY_OPTIONS}
          />
          <p id="settings-visibility-helper" className={FIELD_HELPER}>
            {visibilityMeta[form.visibility].helper}
            {linksText && ` ${linksText}`}
          </p>
        </Panel>

        <Panel title="Advanced">
          <div className="space-y-4">
            <div>
              <label className={FIELD_LABEL}>Currency</label>
              <Select
                value={form.currency}
                onChange={(v) => onEdit({ currency: v })}
                options={currencySelectOptions}
                ariaLabel="Wishlist currency"
                size="lg"
                triggerClassName="w-full"
                disabled={saving}
              />
              <p className={FIELD_HELPER}>Default currency for prices in this wishlist.</p>
            </div>

            <Field
              label="Link"
              id="settings-slug"
              helper="The wishlist's web address. Lowercase letters, numbers, and hyphens."
            >
              <Input
                leading={<span className="text-sm">/wishlists/</span>}
                value={form.slug}
                onChange={(e) =>
                  onEdit({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
                }
                disabled={saving}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
              />
            </Field>
            {slugChanged && <Callout tone="warning">{SLUG_CHANGE_WARNING}</Callout>}
          </div>
        </Panel>

        {/* Only while there's something to save. Sticks to the bottom of the
            screen while the form runs past it (above a phone's tab bar,
            `--tab-bar-space`), and rests under the form. */}
        {dirty && (
          <div className="sticky bottom-[calc(1rem+var(--tab-bar-space,0px))] z-20 flex items-center gap-3 rounded-2xl border border-border bg-surface py-3 pl-4 pr-3 shadow-lg sm:pl-5">
            <p className="min-w-0 flex-1 text-sm font-medium text-foreground">Unsaved changes</p>
            <Button variant="secondary" onClick={onDiscard} disabled={saving}>
              Discard
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </form>

      {onStartNew && (
        <Panel variant="list" title="Next occasion">
          <ActionRow title="Start a new list from this one" description={START_NEW_LIST_TEXT}>
            <Button variant="secondary" size="sm" icon="plus" onClick={onStartNew}>
              Start new list
            </Button>
          </ActionRow>
        </Panel>
      )}

      <Panel variant="list" title="Danger zone">
        <ActionRow
          title={archived ? 'Unarchive wishlist' : 'Archive wishlist'}
          description={
            archived
              ? 'This wishlist is archived: only owners can see it. Unarchive it to open it again to members, and to anyone its visibility allows.'
              : ARCHIVE_EXPLANATION
          }
        >
          <Button
            variant="secondary"
            size="sm"
            icon="archive"
            onClick={archived ? onUnarchive : onArchive}
            disabled={archiving}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </Button>
        </ActionRow>
        <ActionRow title="Delete wishlist" description={DELETE_LIST_WARNING}>
          <Button variant="danger" size="sm" onClick={onDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </ActionRow>
      </Panel>
    </div>
  );
}

/** One act in Next occasion or the Danger zone: what it is and does, and its button. */
function ActionRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <PanelRow className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex-shrink-0">{children}</div>
    </PanelRow>
  );
}
