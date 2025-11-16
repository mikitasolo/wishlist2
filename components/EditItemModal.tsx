'use client';

import { useState, useEffect } from 'react';
import { IItem } from '@/models/Item';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ConfirmDialog from './ConfirmDialog';

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: Partial<IItem>) => Promise<void>;
  onDelete?: () => Promise<void>;
  item: IItem;
}

export default function EditItemModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  item,
}: EditItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Reset states when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }, [isOpen]);

  const handleSubmit = async (data: {
    name: string;
    imageUrl?: string;
    priceInCents?: number;
    link?: string;
    notes?: string;
    status: 'draft' | 'available' | 'proposed';
  }) => {
    setIsSubmitting(true);
    try {
      const updates: Partial<IItem> = {
        name: data.name || undefined,
        imageUrl: data.imageUrl,
        priceInCents: data.priceInCents,
        link: data.link,
        notes: data.notes,
      };
      // Don't change status for proposed items (proposers can't change status)
      if (item.status !== 'proposed') {
        updates.status = data.status;
      }
      await onSave(updates);
      onClose();
    } catch (error) {
      console.error('Error updating item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
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
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title={item.status === 'proposed' ? 'Edit Proposed Item' : 'Edit Item'}
        titleId="edit-item-title"
        isSubmitting={isSubmitting || isDeleting}
      >
        {item.status === 'proposed' && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
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
                You can edit this proposed item. The status cannot be changed until the owner
                reviews it.
              </p>
            </div>
          </div>
        )}
        <ItemForm
          initialData={itemToFormData(item)}
          onSubmit={handleSubmit}
          onCancel={onClose}
          submitLabel="Save Changes"
          submittingLabel="Saving..."
          isSubmitting={isSubmitting || isDeleting}
          mode={item.status === 'proposed' ? 'propose' : 'create'}
          renderButtons={({ submitting, onCancel, submitLabel, submittingLabel }) => (
            <div className="flex flex-col gap-3 pt-4">
              <div className="flex gap-3">
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
              {onDelete && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  disabled={submitting}
                >
                  Delete Item
                </button>
              )}
            </div>
          )}
        />
      </BaseModal>

      {/* Delete Confirmation Dialog */}
      {onDelete && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="Delete Item"
          message="Are you sure you want to delete this item? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmText="Delete"
          cancelText="Cancel"
          type="danger"
        />
      )}
    </>
  );
}
