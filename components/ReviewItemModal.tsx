'use client';

import { useState, useEffect } from 'react';
import { IItem } from '@/models/Item';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ConfirmDialog from './ConfirmDialog';

interface ReviewItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApprove: (updates: Partial<IItem> & { status: 'draft' | 'available' }) => Promise<void>;
  onDelete?: () => Promise<void>;
  item: IItem;
}

export default function ReviewItemModal({ isOpen, onClose, onApprove, onDelete, item }: ReviewItemModalProps) {
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
      // In review mode, status will always be 'draft' or 'available', never 'proposed'
      if (data.status === 'proposed') {
        throw new Error('Cannot approve item with proposed status');
      }
      const updates: Partial<IItem> & { status: 'draft' | 'available' } = {
        name: data.name || undefined,
        imageUrl: data.imageUrl,
        priceInCents: data.priceInCents,
        link: data.link,
        notes: data.notes,
        status: data.status,
        proposedBy: null, // Clear proposedBy when approving
      };
      await onApprove(updates);
      onClose();
    } catch (error) {
      console.error('Error approving item:', error);
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

  // Convert proposed item to form data (status will be set to available by default)
  const formData = itemToFormData(item);
  formData.isDraft = false; // Default to published when reviewing

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="Review Proposed Item"
        titleId="review-item-title"
        isSubmitting={isSubmitting || isDeleting}
      >
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <p className="text-sm text-yellow-800">
              Review this proposed item. You can edit any fields, select the status (Published or Draft), and then approve or delete it.
            </p>
          </div>
        </div>
        <ItemForm
          initialData={formData}
          onSubmit={handleSubmit}
          onCancel={onClose}
          submitLabel="Approve Item"
          submittingLabel="Approving..."
          isSubmitting={isSubmitting || isDeleting}
          mode="review"
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
          title="Delete Proposed Item"
          message="Are you sure you want to delete this proposed item? This action cannot be undone."
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

