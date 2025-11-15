'use client';

import { useState, useEffect, useRef } from 'react';
import { IItem } from '@/models/Item';
import { centsToDollars, dollarsToCents } from '@/lib/utils/currency';
import ConfirmDialog from '@/components/ConfirmDialog';

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<IItem>) => Promise<void>;
  onDelete?: () => Promise<void>;
  item: IItem;
}

export default function EditItemModal({ isOpen, onClose, onSave, onDelete, item }: EditItemModalProps) {
  const [formData, setFormData] = useState({
    name: item.name,
    imageUrl: item.imageUrl || '',
    price: centsToDollars(item.priceInCents),
    link: item.link || '',
    isDraft: item.status === 'draft',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Update form when item changes
  useEffect(() => {
    setFormData({
      name: item.name,
      imageUrl: item.imageUrl || '',
      price: centsToDollars(item.priceInCents),
      link: item.link || '',
      isDraft: item.status === 'draft',
    });
  }, [item]);

  // Focus first input when modal opens
  useEffect(() => {
    if (isOpen && firstInputRef.current) {
      setTimeout(() => firstInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Handle Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSubmitting, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Convert price from dollars to cents (only if price is provided)
      const priceInCents = formData.price ? dollarsToCents(formData.price) : undefined;
      
      const updates: Partial<IItem> = {
        name: formData.name.trim() || undefined,
        imageUrl: formData.imageUrl?.trim() || undefined,
        priceInCents,
        link: formData.link?.trim() || undefined,
        status: formData.isDraft ? 'draft' : 'available',
      };
      
      await onSave(updates);
      
      onClose();
    } catch (error) {
      console.error('Error updating item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && !isSubmitting) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={handleBackdropClick}
    >
      <div 
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-4 sm:p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-item-title"
      >
        <div className="flex justify-between items-center mb-4 sm:mb-6">
          <h2 id="edit-item-title" className="text-xl sm:text-2xl font-bold text-gray-800">Edit Item</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl leading-none cursor-pointer"
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <p className="text-xs text-gray-500 mb-2">
              Draft items are not visible to others and can have incomplete information
            </p>
            <div className="flex items-center justify-between p-1 bg-gray-100 rounded-lg">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, isDraft: false })}
                disabled={isSubmitting}
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
                disabled={isSubmitting}
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
              disabled={isSubmitting}
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor="imageUrl" className="block text-sm font-medium text-gray-700 mb-1">
              Image URL {!formData.isDraft && '*'}
            </label>
            <input
              type="url"
              id="imageUrl"
              required={!formData.isDraft}
              value={formData.imageUrl}
              onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              placeholder="https://example.com/image.jpg"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="price" className="block text-sm font-medium text-gray-700 mb-1">
              Price
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
              disabled={isSubmitting}
            />
          </div>

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
              disabled={isSubmitting}
            />
          </div>

          <div className="flex flex-col gap-3 pt-4">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium cursor-pointer"
                disabled={isSubmitting || isDeleting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                disabled={isSubmitting || isDeleting}
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
            {onDelete && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                disabled={isSubmitting || isDeleting}
              >
                Delete Item
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Delete Confirmation Dialog */}
      {onDelete && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="Delete Item"
          message="Are you sure you want to delete this item? This action cannot be undone."
          onConfirm={async () => {
            setIsDeleting(true);
            try {
              await onDelete();
              setShowDeleteConfirm(false);
              onClose();
            } catch (error) {
              console.error('Error deleting item:', error);
            } finally {
              setIsDeleting(false);
            }
          }}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmText="Delete"
          cancelText="Cancel"
          type="danger"
        />
      )}
    </div>
  );
}

