'use client';

import { useState, useRef, useEffect } from 'react';
import { ApiItem } from '@/types/api';

export interface ItemFormData {
  name: string;
  imageUrl: string;
  price: string;
  currency: string;
  link: string;
  notes: string;
  isDraft: boolean;
}

// Most popular currencies (shown first)
const POPULAR_CURRENCIES = ['USD', 'EUR', 'PLN', 'BYN', 'RUB'];

// Common currencies list
const COMMON_CURRENCIES = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'BYN', name: 'Belarusian Ruble' },
  { code: 'RUB', name: 'Russian Ruble' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'ZAR', name: 'South African Rand' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
];

interface ItemFormProps {
  initialData?: ItemFormData;
  onSubmit: (data: {
    name: string;
    imageUrl?: string;
    price?: { value: number; currency: string } | null;
    link?: string;
    notes?: string;
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
  mode?: 'create' | 'propose' | 'review';
  // Optional: item ID to track when switching between different items
  itemId?: string;
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
}: ItemFormProps) {
  const defaultInitialData: ItemFormData = {
    name: '',
    imageUrl: '',
    price: '',
    currency: 'USD', // Display uppercase in UI, but will be converted to lowercase on submit
    link: '',
    notes: '',
    isDraft: false,
  };

  const [formData, setFormData] = useState<ItemFormData>(initialData || defaultInitialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCurrencyOpen, setIsCurrencyOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState('');
  const currencyRef = useRef<HTMLDivElement>(null);
  const internalFirstInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = externalFirstInputRef || internalFirstInputRef;
  const submitting = externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;

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
        lastInitializedItemIdRef.current = currentItemId;
      }
    }
  }, [initialData, itemId]);

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

      let status: 'draft' | 'available' | 'proposed';
      if (mode === 'propose') {
        status = 'proposed';
      } else {
        status = formData.isDraft ? 'draft' : 'available';
      }

      await onSubmit({
        name: formData.name.trim(),
        imageUrl: formData.imageUrl.trim() || undefined,
        price,
        link: formData.link.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        status,
      });

      // Reset form only if not using external state
      if (!initialData) {
        setFormData(defaultInitialData);
        lastInitializedItemIdRef.current = undefined;
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
      {/* Status Toggle - hidden in propose mode */}
      {mode !== 'propose' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
          {mode === 'review' ? (
            <p className="text-xs text-gray-500 mb-2">
              Select the status for this item after review
            </p>
          ) : (
            <p className="text-xs text-gray-500 mb-2">Draft items are not visible to others</p>
          )}
          <div className="relative flex items-center justify-between p-1 bg-gray-100 rounded-lg">
            {/* Sliding indicator */}
            <div
              className={`absolute top-1 bottom-1 bg-white rounded-md shadow-sm transition-all duration-300 ease-in-out ${
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
                !formData.isDraft ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Published
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isDraft: true })}
              disabled={submitting}
              className={`relative z-10 flex-1 px-4 py-2 text-sm font-medium rounded-md transition-colors duration-300 cursor-pointer ${
                formData.isDraft ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Draft
            </button>
          </div>
        </div>
      )}

      {/* Tip for propose mode */}
      {mode === 'propose' && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
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
            <p className="text-sm text-blue-800">
              This item will appear in the wishlist after approval from the wishlist owner.
            </p>
          </div>
        </div>
      )}

      {/* Item Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
          Item Name *
        </label>
        <input
          type="text"
          id="name"
          required
          ref={firstInputRef}
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          placeholder="Enter item name"
          disabled={submitting}
          aria-required="true"
        />
      </div>

      {/* Image URL */}
      <div>
        <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-1">
          Image URL
        </label>
        <input
          type="url"
          id="imageUrl"
          value={formData.imageUrl}
          onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          placeholder="https://example.com/image.jpg"
          disabled={submitting}
        />
      </div>

      {/* Price */}
      <div>
        <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
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
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            placeholder="99.99"
            disabled={submitting}
          />
          <div ref={currencyRef} className="relative flex-1">
            <button
              type="button"
              onClick={() => !submitting && setIsCurrencyOpen(!isCurrencyOpen)}
              disabled={submitting}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none bg-white text-left w-full flex items-center justify-between"
            >
              <span>{formData.currency}</span>
              <svg
                className={`w-4 h-4 text-gray-500 transition-transform ${
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
              <div className="absolute z-50 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col">
                <div className="p-2 border-b border-gray-200">
                  <input
                    type="text"
                    placeholder="Search currency..."
                    value={currencySearch}
                    onChange={(e) => setCurrencySearch(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none text-sm"
                    autoFocus
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
                      className={`w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors ${
                        formData.currency === curr.code ? 'bg-primary-50 text-primary-700' : ''
                      } ${POPULAR_CURRENCIES.includes(curr.code) ? 'font-medium' : ''}`}
                    >
                      <span className="font-mono">{curr.code}</span>
                      <span className="ml-2 text-gray-600 text-sm">{curr.name}</span>
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
        <label htmlFor="link" className="block text-sm font-medium text-gray-700 mb-1">
          Product Link
        </label>
        <input
          type="url"
          id="link"
          value={formData.link}
          onChange={(e) => setFormData({ ...formData, link: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          placeholder="https://example.com/product"
          disabled={submitting}
        />
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
          Notes
        </label>
        <textarea
          id="notes"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none resize-none"
          placeholder="Add any additional notes about this item like size, color, etc..."
          rows={3}
          maxLength={100}
          disabled={submitting}
        />
        <p className="text-xs text-gray-500 mt-1">{formData.notes.length}/100 characters</p>
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
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer"
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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
