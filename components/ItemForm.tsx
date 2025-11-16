'use client';

import { useState, useRef, useEffect } from 'react';
import { IItem } from '@/models/Item';
import { centsToDollars, dollarsToCents } from '@/lib/utils/currency';

export interface ItemFormData {
  name: string;
  imageUrl: string;
  price: string;
  link: string;
  notes: string;
  isDraft: boolean;
}

interface ItemFormProps {
  initialData?: ItemFormData;
  onSubmit: (data: {
    name: string;
    imageUrl?: string;
    priceInCents?: number;
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
}: ItemFormProps) {
  const defaultInitialData: ItemFormData = {
    name: '',
    imageUrl: '',
    price: '',
    link: '',
    notes: '',
    isDraft: false,
  };

  const [formData, setFormData] = useState<ItemFormData>(initialData || defaultInitialData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const internalFirstInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = externalFirstInputRef || internalFirstInputRef;
  const submitting = externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;

  // Update form when initialData changes (for edit mode)
  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentSubmitting =
      externalIsSubmitting !== undefined ? externalIsSubmitting : isSubmitting;
    if (currentSubmitting) return;

    if (externalIsSubmitting === undefined) {
      setIsSubmitting(true);
    }

    try {
      const priceInCents = formData.price ? dollarsToCents(formData.price) : undefined;

      let status: 'draft' | 'available' | 'proposed';
      if (mode === 'propose') {
        status = 'proposed';
      } else {
        status = formData.isDraft ? 'draft' : 'available';
      }

      await onSubmit({
        name: formData.name.trim(),
        imageUrl: formData.imageUrl.trim() || undefined,
        priceInCents,
        link: formData.link.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        status,
      });

      // Reset form only if not using external state
      if (!initialData) {
        setFormData(defaultInitialData);
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
          <div className="flex items-center justify-between p-1 bg-gray-100 rounded-lg">
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isDraft: false })}
              disabled={submitting}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                !formData.isDraft
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              Published
            </button>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, isDraft: true })}
              disabled={submitting}
              className={`flex-1 px-4 py-2 text-sm font-medium rounded-md transition-all cursor-pointer ${
                formData.isDraft
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
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
          Price in $
        </label>
        <input
          type="number"
          id="price"
          step="0.01"
          min="0"
          value={formData.price}
          onChange={(e) => setFormData({ ...formData, price: e.target.value })}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          placeholder="99.99"
          disabled={submitting}
        />
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

// Helper function to convert IItem to ItemFormData
export function itemToFormData(item: IItem): ItemFormData {
  return {
    name: item.name,
    imageUrl: item.imageUrl || '',
    price: centsToDollars(item.priceInCents),
    link: item.link || '',
    notes: item.notes || '',
    isDraft: item.status === 'draft',
  };
}
