'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import ImageUpload from './ImageUpload';
import Toggle from './Toggle';
import Button from './Button';
import Field from './Field';
import Icon from './Icon';
import Input from './Input';
import Textarea from './Textarea';
import { FIELD_LABEL, inputClassName } from './fieldStyles';
import {
  CURRENCY_OPTIONS as COMMON_CURRENCIES,
  POPULAR_CURRENCIES,
  defaultItemCurrency,
} from '@/lib/utils/currencies';
import {
  itemChanges,
  itemFormContent,
  type ItemContentChanges,
  type ItemFormData,
} from '@/lib/utils/itemForm';
import { currencySymbol, formatPriceInput, parsePriceInput } from '@/lib/utils/currency';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { STATUS_META } from '@/lib/utils/itemStatus';

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
  isDraft: false,
};

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
  // Currency a new item starts on (see defaultItemCurrency; USD if omitted).
  // Read once on mount so it never overwrites what the user picked; ignored when
  // initialData is given, which carries its own currency (see itemToFormData).
  defaultCurrency?: string;
}

export default function ItemForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  submittingLabel = 'Submitting…',
  isSubmitting: externalIsSubmitting,
  firstInputRef: externalFirstInputRef,
  renderButtons,
  mode = 'create',
  itemId,
  onFormChange,
  defaultCurrency,
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
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const currencyRef = useRef<HTMLDivElement>(null);
  const internalFirstInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = externalFirstInputRef || internalFirstInputRef;
  const submitting = externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;

  // Track initial data for comparison
  const initialDataRef = useRef<ItemFormData>(initialData || blankFormData);

  // Close currency dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (currencyRef.current && !currencyRef.current.contains(event.target as Node)) {
        setIsCurrencyOpen(false);
        setCurrencySearch('');
      }
    }

    if (isCurrencyOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isCurrencyOpen]);

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

  // An amount that can't be read is refused, not saved as "no price": the
  // browser won't submit the form while the field says why, as it does for a
  // missing name, and handleSubmit checks again.
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
  useEffect(() => {
    priceInputRef.current?.setCustomValidity(priceError ?? '');
  }, [priceError]);

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

  // Check if form has changes and notify parent
  useEffect(() => {
    if (!onFormChange) return;

    const hasChanges = JSON.stringify(formData) !== JSON.stringify(initialDataRef.current);
    onFormChange(hasChanges);
  }, [formData, onFormChange]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentSubmitting =
      externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;
    if (currentSubmitting) return;
    if (!priceReadable) {
      setShowPriceError(true);
      priceInputRef.current?.focus();
      return;
    }

    if (externalIsSubmitting === undefined) {
      setIsSubmitting(true);
    }

    try {
      // Trimmed, the price in cents and its currency lowercase (to match rates).
      const content = itemFormContent(formData, locale);

      // Status is only chosen in the form when creating or reviewing. When
      // editing an existing item, status is managed separately (publish / move
      // to draft actions) so a content edit never disturbs booking state.
      let status: 'draft' | 'available' | 'proposed';
      if (mode === 'propose') {
        status = 'proposed';
      } else {
        status = formData.isDraft ? 'draft' : 'available';
      }

      // When editing (initialData exists), send null for empty fields to clear them
      // When creating, use undefined to omit them
      const isEditing = !!initialData;

      await onSubmit(
        {
          name: content.name,
          imageUrl: isEditing ? content.imageUrl : content.imageUrl || undefined,
          price: content.price,
          link: isEditing ? content.link : content.link || undefined,
          notes: isEditing ? content.notes : content.notes || undefined,
          mostWanted: mode === 'propose' ? undefined : content.mostWanted,
          status,
        },
        itemChanges(formData, initialDataRef.current, locale)
      );

      // Reset form only if not using external state
      if (!initialData) {
        setFormData(blankFormData);
        setShowPriceError(false);
        initialDataRef.current = blankFormData;
        lastInitializedItemIdRef.current = undefined;
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
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Status toggle — only when creating a new item or reviewing a proposal.
          Editing never shows it; status is changed via publish / move-to-draft. */}
      {(mode === 'create' || mode === 'review') && (
        <div>
          <label className={FIELD_LABEL}>Status</label>
          {mode === 'review' ? (
            <p className="text-xs text-muted-foreground mb-2">
              Select the status for this item after review
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mb-2">
              Draft items are not visible to others
            </p>
          )}
          <div className="relative flex items-center justify-between p-1 bg-muted rounded-lg">
            {/* Sliding indicator */}
            <div
              className={`absolute top-1 bottom-1 bg-surface rounded-md shadow-sm transition-all duration-300 ease-in-out ${
                !formData.isDraft
                  ? 'left-1 right-[calc(50%+0.25rem)]'
                  : 'left-[calc(50%+0.25rem)] right-1'
              }`}
            />
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isDraft: false })}
              disabled={submitting}
              className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-300 cursor-pointer ${
                !formData.isDraft
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Published
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isDraft: true })}
              disabled={submitting}
              className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-300 cursor-pointer ${
                formData.isDraft ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Draft
            </button>
          </div>
        </div>
      )}

      {/* Tip for propose mode */}
      {mode === 'propose' && (
        <div className={`rounded-lg p-4 ${STATUS_META.proposed.classes.notice}`}>
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-sm">
              This item will appear in the wishlist after approval from the wishlist owner.
            </p>
          </div>
        </div>
      )}

      {/* Item name */}
      <Field label="Item name *" id="name">
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

      {/* Image */}
      <div>
        <label className={FIELD_LABEL}>Image</label>
        {/* An upload lands after the render that started it: update the form as it is by then. */}
        <ImageUpload
          value={formData.imageUrl || null}
          onChange={(url) => setFormData((f) => ({ ...f, imageUrl: url ?? '' }))}
          disabled={submitting}
          aspect={1}
        />
      </div>

      {/* Price */}
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
          <div ref={currencyRef} className="relative flex-1">
            <button
              type="button"
              onClick={() => !submitting && setIsCurrencyOpen(!isCurrencyOpen)}
              disabled={submitting}
              className={`${inputClassName()} flex items-center justify-between text-left`}
            >
              <span>{formData.currency}</span>
              <Icon
                name="chevron-down"
                size={16}
                className={`text-muted-foreground transition-transform ${
                  isCurrencyOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            {isCurrencyOpen && (
              <div className="absolute z-50 mt-1 w-full bg-surface border border-border-strong rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-border">
                  <input
                    type="text"
                    placeholder="Search currency…"
                    value={currencySearch}
                    onChange={(e) => setCurrencySearch(e.target.value)}
                    className={inputClassName('sm')}
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <div className="overflow-y-auto max-h-48">
                  {COMMON_CURRENCIES.filter(
                    (curr) =>
                      curr.code.toLowerCase().includes(currencySearch.toLowerCase()) ||
                      curr.name.toLowerCase().includes(currencySearch.toLowerCase())
                  ).map((curr) => (
                    <button
                      key={curr.code}
                      type="button"
                      onClick={() => {
                        setFormData({ ...formData, currency: curr.code });
                        setIsCurrencyOpen(false);
                        setCurrencySearch('');
                      }}
                      className={`w-full text-left px-4 py-2 hover:bg-muted transition-colors ${
                        formData.currency === curr.code
                          ? 'bg-primary-500/12 text-primary-700 dark:text-primary-300'
                          : ''
                      } ${POPULAR_CURRENCIES.includes(curr.code) ? 'font-medium' : ''}`}
                    >
                      <span className="font-mono">{curr.code}</span>
                      <span className="ml-2 text-muted-foreground text-sm">{curr.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Field>

      {/* Product link */}
      <Field label="Product link" id="link">
        <Input
          type="url"
          value={formData.link}
          onChange={(e) => setFormData({ ...formData, link: e.target.value })}
          placeholder="https://example.com/product"
          disabled={submitting}
          autoComplete="off"
        />
      </Field>

      {/* Notes */}
      <Field label="Notes" id="notes" helper={`${formData.notes.length}/100 characters`}>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="resize-none"
          placeholder="Add any additional notes about this item like size, color, etc."
          rows={3}
          maxLength={100}
          disabled={submitting}
          autoComplete="off"
        />
      </Field>

      {/* Most wanted — the owners' call, so a proposal never offers it */}
      {mode !== 'propose' && (
        <Toggle
          label="Most wanted"
          description="Gifters see a star on it, and it's listed first."
          checked={formData.mostWanted}
          onChange={(mostWanted) => setFormData({ ...formData, mostWanted })}
          disabled={submitting}
        />
      )}

      {/* Submit and Cancel Buttons */}
      {renderButtons ? (
        renderButtons({
          submitting,
          onCancel,
          submitLabel,
          submittingLabel,
        })
      ) : (
        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel}
            disabled={submitting}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} className="flex-1">
            {submitting ? submittingLabel : submitLabel}
          </Button>
        </div>
      )}
    </form>
  );
}
