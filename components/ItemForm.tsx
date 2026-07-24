'use client';

import { useState, useRef, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import ImageUpload from './ImageUpload';
import { CURRENCY_OPTIONS as COMMON_CURRENCIES, POPULAR_CURRENCIES } from '@/lib/utils/currencies';

export interface ItemFormData {
  name: string;
  imageUrl: string;
  price: string;
  currency: string;
  link: string;
  notes: string;
  isDraft: boolean;
}

// Module-level constant (stable identity) so effects can depend on it safely.
const DEFAULT_ITEM_FORM_DATA: ItemFormData = {
  name: '',
  imageUrl: '',
  price: '',
  currency: 'USD', // Display uppercase in UI; converted to lowercase on submit
  link: '',
  notes: '',
  isDraft: false,
};

interface ItemFormProps {
  initialData?: ItemFormData;
  onSubmit: (data: {
    name: string;
    imageUrl?: string | null;
    price?: { value: number; currency: string } | null;
    link?: string | null;
    notes?: string | null;
    status: 'draft' | 'available' | 'proposed';
  }) => Promise<void>;
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
}

export default function ItemForm({
  initialData,
  onSubmit,
  onCancel,
  submitLabel = 'Submit',
  submittingLabel = 'Submitting...',
  isSubmitting: externalIsSubmitting,
  firstInputRef: externalFirstInputRef,
  renderButtons,
  mode = 'create',
  itemId,
  onFormChange,
}: ItemFormProps) {
  const [formData, setFormData] = useState<ItemFormData>(initialData || DEFAULT_ITEM_FORM_DATA);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const currencyRef = useRef<HTMLDivElement>(null);
  const internalFirstInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = externalFirstInputRef || internalFirstInputRef;
  const submitting = externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;

  // Track initial data for comparison
  const initialDataRef = useRef<ItemFormData>(initialData || DEFAULT_ITEM_FORM_DATA);

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
      initialDataRef.current = DEFAULT_ITEM_FORM_DATA;
    }
  }, [initialData, itemId]);

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

    if (externalIsSubmitting === undefined) {
      setIsSubmitting(true);
    }

    try {
      let price: { value: number; currency: string } | null = null;
      if (formData.price) {
        const priceValue = parseFloat(formData.price);
        if (!isNaN(priceValue) && priceValue >= 0) {
          // Convert dollars to cents (integer)
          const priceInCents = Math.round(priceValue * 100);
          price = {
            value: priceInCents,
            currency: (formData.currency || 'USD').toLowerCase(), // Store in lowercase to match rates
          };
        }
      }

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
      const trimmedImageUrl = formData.imageUrl.trim();
      const trimmedLink = formData.link.trim();
      const trimmedNotes = formData.notes.trim();

      await onSubmit({
        name: formData.name.trim(),
        imageUrl: isEditing ? trimmedImageUrl || null : trimmedImageUrl || undefined,
        price,
        link: isEditing ? trimmedLink || null : trimmedLink || undefined,
        notes: isEditing ? trimmedNotes || null : trimmedNotes || undefined,
        status,
      });

      // Reset form only if not using external state
      if (!initialData) {
        setFormData(DEFAULT_ITEM_FORM_DATA);
        initialDataRef.current = DEFAULT_ITEM_FORM_DATA;
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
          <label className="block text-sm font-medium text-foreground mb-1">Status</label>
          {mode === 'review' ? (
            <p className="text-xs text-muted-foreground mb-2">
              Select the status for this item after review
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mb-2">Draft items are not visible to others</p>
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
                !formData.isDraft ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
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
        <div className="border border-blue-500/20 bg-blue-500/10 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0"
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
            <p className="text-sm text-blue-700 dark:text-blue-300">
              This item will appear in the wishlist after approval from the wishlist owner.
            </p>
          </div>
        </div>
      )}

      {/* Item Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">
          Item Name *
        </label>
        <input
          type="text"
          id="name"
          required
          ref={firstInputRef}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-4 py-2 border border-border-strong rounded-lg outline-none"
          placeholder="Enter item name"
          disabled={submitting}
          aria-required="true"
          autoComplete="off"
        />
      </div>

      {/* Image */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1">Image</label>
        <ImageUpload
          value={formData.imageUrl || null}
          onChange={(url) => setFormData({ ...formData, imageUrl: url ?? '' })}
          disabled={submitting}
          aspect={1}
        />
      </div>

      {/* Price */}
      <div>
        <label htmlFor="price" className="block text-sm font-medium text-foreground mb-1">
          Price
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            id="price"
            step="0.01"
            min="0"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: e.target.value })}
            // Prevent the mouse wheel from silently changing the value while scrolling.
            onWheel={(e) => e.currentTarget.blur()}
            className="flex-1 px-4 py-2 border border-border-strong rounded-lg outline-none"
            placeholder="99.99"
            disabled={submitting}
            autoComplete="off"
          />
          <div ref={currencyRef} className="relative flex-1">
            <button
              type="button"
              onClick={() => !submitting && setIsCurrencyOpen(!isCurrencyOpen)}
              disabled={submitting}
              className="px-4 py-2 border border-border-strong rounded-lg outline-none bg-surface text-left w-full flex items-center justify-between"
            >
              <span>{formData.currency}</span>
              <svg
                className={`w-4 h-4 text-muted-foreground transition-transform ${
                  isCurrencyOpen ? 'rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
            {isCurrencyOpen && (
              <div className="absolute z-50 mt-1 w-full bg-surface border border-border-strong rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-border">
                  <input
                    type="text"
                    placeholder="Search currency..."
                    value={currencySearch}
                    onChange={(e) => setCurrencySearch(e.target.value)}
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
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
                        formData.currency === curr.code ? 'bg-primary-500/12 text-primary-700 dark:text-primary-300' : ''
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
      </div>

      {/* Product Link */}
      <div>
        <label htmlFor="link" className="block text-sm font-medium text-foreground mb-1">
          Product Link
        </label>
        <input
          type="url"
          id="link"
          value={formData.link}
          onChange={(e) => setFormData({ ...formData, link: e.target.value })}
          className="w-full px-4 py-2 border border-border-strong rounded-lg outline-none"
          placeholder="https://example.com/product"
          disabled={submitting}
          autoComplete="off"
        />
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-foreground mb-1">
          Notes
        </label>
        <textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full px-4 py-2 border border-border-strong rounded-lg outline-none resize-none"
          placeholder="Add any additional notes about this item like size, color, etc..."
          rows={3}
          maxLength={100}
          disabled={submitting}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground mt-1">{formData.notes.length}/100 characters</p>
      </div>

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
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-border-strong text-foreground rounded-lg hover:bg-surface-hover transition-colors font-medium cursor-pointer"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 border border-transparent bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            disabled={submitting}
          >
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      )}
    </form>
  );
}

// Helper function to convert ApiItem to ItemFormData
export function itemToFormData(item: ApiItem): ItemFormData {
  // Convert cents to dollars for display
  const priceInDollars = item.price?.value ? (item.price.value / 100).toFixed(2) : '';
  return {
    name: item.name,
    imageUrl: item.imageUrl || '',
    price: priceInDollars,
    currency: item.price?.currency?.toUpperCase() || 'USD', // Display uppercase in UI
    link: item.link || '',
    notes: item.notes || '',
    isDraft: item.status === 'draft',
  };
}
