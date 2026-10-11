'use client';

import { isVisiblyBlank, nameCharacterProblem } from '@/lib/utils/visibleName';
import { useState, useRef, useEffect, useMemo, useId } from 'react';
import ImageUpload from './ImageUpload';
import Toggle from './Toggle';
import Field from './Field';
import Input from './Input';
import Textarea from './Textarea';
import Select from './Select';
import { FIELD_LABEL } from './fieldStyles';
import { currencySelectOptions, defaultItemCurrency } from '@/lib/utils/currencies';
import { ITEM_NOTES_MAX, isHttpUrl, normalizeItemLink } from '@/lib/utils/itemFields';
import {
  itemChanges,
  rebaseItemForm,
  itemFormContent,
  type ItemContentChanges,
  type ItemFormData,
} from '@/lib/utils/itemForm';
import { currencySymbol, formatPriceInput, parsePriceInput } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { useFreshUploads } from '@/lib/hooks/useFreshUploads';
import type { FreshUploads } from '@/lib/utils/freshUploads';
import ItemLinkPicker, { type LinkOption } from './ItemLinkPicker';
import ItemTagsField from './ItemTagsField';

export { itemToFormData, type ItemFormData } from '@/lib/utils/itemForm';

// Every field of a new item's form except the currency, which depends on the
// wishlist (see the `defaultCurrency` prop).
const BLANK_ITEM_FIELDS: Omit<ItemFormData, 'currency'> = {
  name: '',
  imageUrl: '',
  price: '',
  link: '',
  notes: '',
  mostWanted: false,
  tags: [],
  isDraft: false,
  relatedItems: [],
};

// The notes' counter appears once the text is this close to the limit.
const NOTES_COUNTER_FROM = Math.floor(ITEM_NOTES_MAX * 0.8);

interface ItemFormProps {
  initialData?: ItemFormData;
  // `changes` is the content changed from the form as it was last filled (the
  // item it opened on, or what a save of it stored): see itemChanges. An edit
  // sends only that, so it can't undo a co-owner's change made meanwhile.
  onSubmit: (
    data: {
      name: string;
      imageUrl?: string | null;
      price?: { value: number; currency: string } | null;
      link?: string | null;
      notes?: string | null;
      mostWanted?: boolean; // omitted in propose mode — only owners set it
      status: 'draft' | 'available' | 'proposed';
      // A new item's partners (WIS-29): only with `linkOptions`, only if any.
      linkItems?: string[];
      // A new item's tags (WIS-385): only with `tagOptions`, only if any.
      tags?: string[];
    },
    changes: ItemContentChanges
  ) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  submittingLabel?: string;
  isSubmitting?: boolean;
  firstInputRef?: React.RefObject<HTMLInputElement>;
  renderButtons?: (props: {
    submitting: boolean;
    onCancel: () => void;
    submitLabel: string;
    submittingLabel: string;
  }) => React.ReactNode;
  mode?: 'create' | 'propose' | 'review' | 'edit';
  // Optional: item ID to track when switching between different items
  itemId?: string;
  // Callback to notify parent when form has unsaved changes
  onFormChange?: (hasChanges: boolean) => void;
  // A newer version of the item the form was filled from (its `updatedAt`):
  // when it changes, the fields the person hasn't touched take `initialData`'s
  // values, the touched ones stay, and `initialData` becomes the baseline, so a
  // save sends only what they changed from what they now see (WIS-320).
  rebaseVersion?: string;
  // Currency a new item starts on (see defaultItemCurrency; USD if omitted).
  // Read once on mount so it never overwrites what the user picked; ignored when
  // initialData is given, which carries its own currency (see itemToFormData).
  defaultCurrency?: string;
  // The unsaved uploads, when the caller holds them (see `useFreshUploads`).
  uploads?: FreshUploads;
  // A photo the caller is still fetching when the form opens (WIS-366): the
  // photo field shows it uploading, then takes `url` (null: none) as the form's
  // starting photo, not as an edit. A photo settled before the form opens
  // comes in through `initialData` instead.
  image?: { pending: boolean; url: string | null };
  // The form's id, for the buttons of a pinned footer outside it (a
  // `type="submit"` button with `form={formId}`: see ItemFormFooter). One is made
  // up if omitted. The form clears itself after a new item is saved, whether or
  // not the modal stays open (Keep adding: see handleSubmit).
  formId?: string;
  // The field focus starts on, when the form isn't the name's (Edit opened by
  // an owner's "+ link"). The dialog leaves focus to a field with `autoFocus`.
  initialFocus?: 'link';
  // The other items on the list it can go with (WIS-29), for an owner's add
  // or edit: shows "Goes with". Never given for a proposal or a review.
  linkOptions?: readonly LinkOption[];
  // The tags the list's items carry (WIS-385), for an owner's add or edit:
  // shows Tags. Never given for a proposal, a review or a copy of an item.
  tagOptions?: readonly string[];
}

/**
 * Submits the item form `formId` as `status` (a footer's Save as draft). A plain
 * submit button is the primary action, and the one Enter in a field presses, so
 * the other can't be a submit button of its own that comes first in the tree.
 */
export function submitItemFormAs(formId: string, status: 'draft' | 'available') {
  const form = document.getElementById(formId);
  if (!(form instanceof HTMLFormElement)) return;
  form.dataset.status = status;
  form.requestSubmit();
}

// Whether `form` opens on a link the item schema would refuse (see linkError).
function hasUnacceptedLink(form: ItemFormData | undefined): boolean {
  const link = form ? normalizeItemLink(form.link) : '';
  return !!link && !isHttpUrl(link);
}

export default function ItemForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  submittingLabel = 'Submitting…',
  isSubmitting: externalIsSubmitting,
  firstInputRef: externalFirstInputRef,
  initialFocus,
  renderButtons,
  mode = 'create',
  itemId,
  onFormChange,
  rebaseVersion,
  defaultCurrency,
  formId: externalFormId,
  linkOptions,
  tagOptions,
  uploads: sharedUploads,
  image,
}: ItemFormProps) {
  // The blank form a new item starts from — a stable snapshot, so effects can
  // depend on it. It is also the "unsaved changes" baseline, so a prefilled
  // currency alone never reads as an edit. The currency is shown uppercase and
  // lowercased on submit.
  const [blankFormData] = useState<ItemFormData>(() => ({
    ...BLANK_ITEM_FIELDS,
    currency: defaultItemCurrency(defaultCurrency),
  }));
  const [formData, setFormData] = useState<ItemFormData>(initialData || blankFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Whether to say what's wrong with the price: once the field has been left
  // (or a save tried) with an amount that can't be read, not while it's typed,
  // and until it's left with one that can.
  const [showPriceError, setShowPriceError] = useState(false);
  const priceInputRef = useRef<HTMLInputElement>(null);
  const locale = useViewerLocale();
  const madeUpFormId = useId();
  const formId = externalFormId ?? madeUpFormId;
  // Errors show under the fields once a save has been tried (the name's and
  // the link's), or once the field has been left (the link's, the price's).
  const [attempted, setAttempted] = useState(false);
  // A link the item already holds that the schema now refuses (an older item's
  // or proposal's, from before only http(s) was accepted) says so as the form
  // opens, so the owner fixes or clears it rather than meeting it on save. The
  // form never sends it back as it was: it refuses to submit until it's fixed.
  const [linkLeft, setLinkLeft] = useState(() => hasUnacceptedLink(initialData));
  const linkInputRef = useRef<HTMLInputElement>(null);
  const internalFirstInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = externalFirstInputRef || internalFirstInputRef;
  const submitting = externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;
  // A new item's form that stays open after a save (Keep adding) starts the
  // next item from Name. Set by the save, acted on once the form is enabled
  // again: the name field can't take focus while the save has it disabled.
  const [focusNameNext, setFocusNameNext] = useState(false);
  // Which item the form is for: bumped each time it clears for the next one.
  // A photo still uploading when an item is saved lands after that, and must
  // not end up on the next item: an upload's onChange is the one from the
  // render that started it, so it carries the generation it was started in.
  const [generation, setGeneration] = useState(0);
  const generationRef = useRef(0);
  // Photos uploaded here that no save has taken: one replaced or removed before
  // a save, a late one for an item already saved, and whatever is left when the
  // form goes (the dialog is cancelled or closed) are handed back (WIS-181).
  const ownUploads = useFreshUploads();
  // A caller that outlives the form (the add-from-link flow, whose "Change list"
  // unmounts it) can hold the uploads itself.
  const uploads = sharedUploads ?? ownUploads;
  useEffect(() => {
    if (!focusNameNext || submitting) return;
    setFocusNameNext(false);
    firstInputRef.current?.focus();
  }, [focusNameNext, submitting, firstInputRef]);

  // Track initial data for comparison
  const initialDataRef = useRef<ItemFormData>(initialData || blankFormData);

  // The photo the caller was still fetching when the form opened lands as the
  // form's starting photo (and baseline), once.
  const awaitingImage = useRef(image?.pending ?? false);
  const imagePending = image?.pending ?? false;
  const imageUrl = image?.url ?? null;
  useEffect(() => {
    if (imagePending || !awaitingImage.current) return;
    awaitingImage.current = false;
    if (!imageUrl) return;
    setFormData((f) => ({ ...f, imageUrl }));
    initialDataRef.current = { ...initialDataRef.current, imageUrl };
  }, [imagePending, imageUrl]);

  // Track the last item ID we initialized from
  // Only update form data on initial load or when switching to a different item
  // Never update form data after initial set, even if item changes in DB (preserves user edits)
  const lastInitializedItemIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (initialData) {
      const currentItemId = itemId || JSON.stringify(initialData);
      const isDifferentItem = lastInitializedItemIdRef.current !== currentItemId;
      const isFirstTime = !lastInitializedItemIdRef.current;

      // Only update on first initialization or when switching to a different item
      if (isFirstTime || isDifferentItem) {
        setFormData(initialData);
        initialDataRef.current = initialData;
        lastInitializedItemIdRef.current = currentItemId;
      }
    } else {
      initialDataRef.current = blankFormData;
    }
  }, [initialData, itemId, blankFormData]);

  // Refill from a newer version of the same item (see rebaseVersion). Not on
  // the first fill, which the effect above does.
  const lastVersionRef = useRef(rebaseVersion);
  useEffect(() => {
    if (rebaseVersion === lastVersionRef.current) return;
    lastVersionRef.current = rebaseVersion;
    if (!initialData) return;
    const baseline = initialDataRef.current;
    initialDataRef.current = initialData;
    setFormData((form) => rebaseItemForm(form, baseline, initialData));
  }, [rebaseVersion, initialData]);

  // An amount that can't be read is refused, not saved as "no price": the
  // field says why under it, and handleSubmit won't send it.
  const priceCurrency = formData.currency || 'USD';
  const priceHints = useMemo(
    () => ({
      symbol: currencySymbol(priceCurrency, locale),
      placeholder: formatPriceInput(9999, priceCurrency, locale),
      example: formatPriceInput(34900, priceCurrency, locale),
    }),
    [priceCurrency, locale]
  );
  const priceReadable = parsePriceInput(formData.price, locale).ok;
  const priceError = priceReadable ? null : `Enter a price like ${priceHints.example}`;

  // The link is read the way the server reads it: without a scheme it gets
  // https://, and only an http(s) address is accepted.
  const linkValue = normalizeItemLink(formData.link);
  const linkError =
    linkValue && !isHttpUrl(linkValue) ? 'Enter a web address like https://example.com' : null;
  const trimmedName = formData.name.trim();
  // An existing name the schema now refuses (an older item's) stays editable:
  // it's only checked once it differs from what the form was filled with, as
  // the server only sees a name that changed (itemChanges).
  const nameUnchanged = trimmedName === (initialData?.name ?? '').trim();
  const nameError = isVisiblyBlank(trimmedName)
    ? 'Enter a name for the item'
    : nameUnchanged
      ? null
      : nameCharacterProblem(trimmedName);

  // Leaving the link puts it in full ("amazon.de/x" becomes "https://amazon.de/x").
  const handleLinkBlur = () => {
    setLinkLeft(true);
    if (!linkError && linkValue !== formData.link) setFormData((f) => ({ ...f, link: linkValue }));
  };

  // Leaving the field puts the amount in the same format as the cards ("349"
  // becomes "349.00", or "349,00" where that's how prices are written).
  const handlePriceBlur = () => {
    const amount = parsePriceInput(formData.price, locale);
    setShowPriceError(!amount.ok);
    if (!amount.ok) return;
    setFormData((f) => ({
      ...f,
      price:
        amount.cents === null ? '' : formatPriceInput(amount.cents, f.currency || 'USD', locale),
    }));
  };

  // "Goes with" (WIS-29): an owner's add or edit, on a list with other items.
  const showLinks =
    !!linkOptions && linkOptions.length > 0 && (mode === 'create' || mode === 'edit');
  // Tags (WIS-385): an owner's add or edit, never a proposal's.
  const showTags = !!tagOptions && (mode === 'create' || mode === 'edit');

  // Check if form has changes and notify parent
  useEffect(() => {
    if (!onFormChange) return;

    const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialDataRef.current);
    onFormChange(hasChanges);
  }, [formData, onFormChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The photo being fetched is part of the item: a save waits for it (the
    // footer's buttons are held, and so is Enter in a field).
    if (imagePending) {
      delete (e.currentTarget as HTMLFormElement).dataset.status;
      return;
    }
    const currentSubmitting =
      externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;
    // The status a footer's Save as draft asked for (see submitItemFormAs),
    // read once and cleared, so a refused save can't leave it for the next.
    const form = e.currentTarget as HTMLFormElement;
    const asked = form.dataset.status;
    delete form.dataset.status;
    if (currentSubmitting) return;
    // The first invalid field says what's wrong and takes focus.
    setAttempted(true);
    if (nameError) {
      firstInputRef.current?.focus();
      return;
    }
    if (linkError) {
      linkInputRef.current?.focus();
      return;
    }
    if (!priceReadable) {
      setShowPriceError(true);
      priceInputRef.current?.focus();
      return;
    }

    if (externalIsSubmitting === undefined) {
      setIsSubmitting(true);
    }

    try {
      // Trimmed, the price in cents and its currency uppercase (as stored).
      const content = itemFormContent(formData, locale);

      // Status is only chosen when creating or reviewing, by the button that
      // submitted the form (see submitItemFormAs). When
      // editing an existing item, status is managed separately (publish / move
      // to draft actions) so a content edit never disturbs booking state.
      let status: 'draft' | 'available' | 'proposed';
      if (mode === 'propose') {
        status = 'proposed';
      } else if (mode === 'create' || mode === 'review') {
        // The button pressed says which: a footer's draft action, or the
        // primary (Add to list).
        status = asked === 'draft' ? 'draft' : 'available';
      } else {
        status = formData.isDraft ? 'draft' : 'available';
      }

      // When editing (initialData exists), send null for empty fields to clear them
      // When creating, use undefined to omit them
      const isEditing = !!initialData;

      // The photo this save carries is the save's from here on. A failed save
      // can't say whether it landed (the dialogs reject either way), so a
      // photo it carried is never handed back, even once the dialog closes.
      const settleUpload = uploads.saving(content.imageUrl);
      await onSubmit(
        {
          name: content.name,
          imageUrl: isEditing ? content.imageUrl : content.imageUrl || undefined,
          price: content.price,
          link: isEditing ? content.link : content.link || undefined,
          notes: isEditing ? content.notes : content.notes || undefined,
          mostWanted: mode === 'propose' ? undefined : content.mostWanted,
          status,
          ...(!isEditing && showLinks && formData.relatedItems.length
            ? { linkItems: formData.relatedItems }
            : {}),
          ...(!isEditing && showTags && content.tags.length ? { tags: content.tags } : {}),
        },
        itemChanges(formData, initialDataRef.current, locale)
      ).catch((error: unknown) => {
        settleUpload('unknown');
        throw error;
      });
      settleUpload('saved');

      // A new item's form clears for the next one (it only stays open with
      // Keep adding). The currency stays as it was picked: the next item is
      // most likely priced in it, and the cleared form is the new "unsaved
      // changes" baseline, so it alone is not an edit.
      if (!initialData) {
        const next = { ...blankFormData, currency: formData.currency };
        generationRef.current += 1;
        setGeneration(generationRef.current);
        setFormData(next);
        setShowPriceError(false);
        setAttempted(false);
        setLinkLeft(false);
        initialDataRef.current = next;
        lastInitializedItemIdRef.current = undefined;
        setFocusNameNext(true);
      } else {
        // Update initial data ref to reflect successful submission
        initialDataRef.current = formData;
      }
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      if (externalIsSubmitting === undefined) {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
      {/* The form's default button, so Enter in a field submits it even though the
          visible ones are in a footer outside it (a browser finds those through
          their `form` attribute; this one is in the tree for everything else). */}
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      {/* A proposal is the owners' to approve, and never says whose it is. */}
      {mode === 'propose' && (
        <p className="text-sm text-muted-foreground">
          The owners will review it before it&apos;s added
        </p>
      )}

      {/* Item name */}
      <Field label="Item name *" id="name" error={attempted ? nameError : undefined}>
        <Input
          required
          ref={firstInputRef}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Enter item name"
          disabled={submitting}
          aria-required="true"
          autoComplete="off"
        />
      </Field>

      {/* Product link: typed without a scheme, it gets https:// when it's left. */}
      <Field
        label="Product link"
        id="link"
        error={(attempted || linkLeft) && linkError ? linkError : undefined}
      >
        <Input
          ref={linkInputRef}
          autoFocus={initialFocus === 'link'}
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          value={formData.link}
          onChange={(e) => setFormData({ ...formData, link: e.target.value })}
          onBlur={handleLinkBlur}
          placeholder="https://example.com/product"
          disabled={submitting}
          autoComplete="off"
        />
      </Field>

      {/* Price: the amount and its currency on one line */}
      <Field label="Price" id="price" error={showPriceError && priceError ? priceError : undefined}>
        <div className="flex gap-2">
          {/* Text, not a number field: that one shows the browser's decimal
              format whatever the cards use, and refuses the other separator. */}
          <Input
            ref={priceInputRef}
            inputMode="decimal"
            leading={<span aria-hidden="true">{priceHints.symbol}</span>}
            value={formData.price}
            onChange={(e) => {
              const price = e.target.value;
              setFormData((f) => ({ ...f, price }));
            }}
            onBlur={handlePriceBlur}
            className="min-w-0 flex-1"
            placeholder={priceHints.placeholder}
            disabled={submitting}
            autoComplete="off"
          />
          <Select
            ariaLabel="Currency"
            size="lg"
            value={formData.currency}
            onChange={(currency) => setFormData((f) => ({ ...f, currency }))}
            options={currencySelectOptions}
            valueLabel={formData.currency}
            disabled={submitting}
            triggerClassName="w-28 flex-shrink-0"
          />
        </div>
      </Field>

      {/* Notes */}
      <Field
        label="Notes"
        id="notes"
        helper={
          formData.notes.length >= NOTES_COUNTER_FROM
            ? `${formData.notes.length}/${ITEM_NOTES_MAX} characters`
            : undefined
        }
      >
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="resize-none"
          placeholder="e.g. size, colour or model"
          rows={3}
          maxLength={ITEM_NOTES_MAX}
          disabled={submitting}
          autoComplete="off"
        />
      </Field>

      {/* Photo: a small row, not a drop zone. An image dropped or pasted anywhere is taken. */}
      <div>
        <span className={FIELD_LABEL}>Photo</span>
        {/* An upload lands after the render that started it: update the form as it is by then. */}
        <ImageUpload
          compact
          value={formData.imageUrl || null}
          onChange={(url) => {
            if (generation !== generationRef.current) {
              uploads.discard(url);
              return;
            }
            setFormData((f) => ({ ...f, imageUrl: url ?? '' }));
          }}
          uploads={uploads}
          busy={imagePending}
          disabled={submitting}
          aspect={1}
        />
      </div>

      {/* Most wanted: the owners' call, so a proposal never offers it */}
      {mode !== 'propose' && (
        <Toggle
          label="Most wanted"
          description="Gifters see a star on it, and it's listed first."
          checked={formData.mostWanted}
          onChange={(mostWanted) => setFormData({ ...formData, mostWanted })}
          disabled={submitting}
        />
      )}

      {showTags && (
        <ItemTagsField
          options={tagOptions!}
          selected={formData.tags}
          onChange={(tags) => setFormData((f) => ({ ...f, tags }))}
          disabled={submitting}
        />
      )}

      {showLinks && (
        <ItemLinkPicker
          options={linkOptions!}
          selected={formData.relatedItems}
          onChange={(relatedItems) => setFormData((f) => ({ ...f, relatedItems }))}
          disabled={submitting}
        />
      )}

      {renderButtons?.({ submitting, onCancel, submitLabel, submittingLabel })}
    </form>
  );
}
