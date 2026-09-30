'use client';

import { useState, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ConfirmDialog from './ConfirmDialog';
import { defaultItemCurrency } from '@/lib/utils/currencies';

interface ReviewItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Must reject when the request fails: the modal only closes on success, so
  // the owner's edits survive a failure.
  onApprove: (updates: Partial<ApiItem> & { status: 'draft' | 'available' }) => Promise<void>;
  onDelete?: () => Promise<void>;
  item: ApiItem;
  // A priceless proposal's currency starts on the wishlist's, else the viewer's
  // default, else USD. Required (though either may be empty) so a caller can't
  // silently drop them and fall back to USD.
  wishlistCurrency: string | null | undefined;
  userCurrency: string | null | undefined;
}

export default function ReviewItemModal({
  isOpen,
  onClose,
  onApprove,
  onDelete,
  item,
  wishlistCurrency,
  userCurrency,
}: ReviewItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  // Reset states when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setShowDeleteConfirm(false);
      setHasUnsavedChanges(false);
      setShowConfirmClose(false);
    }
  }, [isOpen]);

  // Use key prop to force ItemForm to remount when modal opens with a different item
  // This ensures form state is reset when switching between items
  const itemFormKey = isOpen ? `review-item-${item._id}` : undefined;

  const handleSubmit = async (data: {
    name: string;
    imageUrl?: string | null;
    price?: { value: number; currency: string } | null;
    link?: string | null;
    notes?: string | null;
    mostWanted?: boolean;
    status: 'draft' | 'available' | 'proposed';
  }) => {
    setIsSubmitting(true);
    // No catch: a failed approve must reject through to ItemForm, so it keeps
    // the proposal as its unsaved-changes baseline. Only a success closes the modal.
    try {
      // In review mode, status will always be 'draft' or 'available', never 'proposed'
      if (data.status === 'proposed') {
        throw new Error('Cannot approve item with proposed status');
      }
      const updates: Partial<ApiItem> & { status: 'draft' | 'available' } = {
        name: data.name || undefined,
        // Include fields even if null to clear them
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : undefined,
        price: data.price !== undefined ? data.price : undefined,
        link: data.link !== undefined ? data.link : undefined,
        notes: data.notes !== undefined ? data.notes : undefined,
        mostWanted: data.mostWanted,
        status: data.status,
        proposedBy: null, // Clear proposedBy when approving
      };
      await onApprove(updates);
      setHasUnsavedChanges(false);
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  // onDelete rejects when the delete fails (after showing the error), so only a
  // real delete closes the modal. Either way the confirmation is answered: on a
  // failure it drops back to this modal, item intact, for a retry or cancel.
  // The confirmation shows the delete as running, and ignores a second click,
  // until this settles.
  const handleDelete = async () => {
    if (!onDelete) return;
    try {
      await onDelete();
      setHasUnsavedChanges(false);
      onClose();
    } catch (error) {
      console.error('Error deleting item:', error);
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  const handleConfirmClose = () => {
    setShowConfirmClose(false);
    setHasUnsavedChanges(false);
    onClose();
  };

  // Convert proposed item to form data (status will be set to available by default)
  const formData = itemToFormData(item, defaultItemCurrency(wishlistCurrency, userCurrency));
  formData.isDraft = false; // Default to published when reviewing

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title="Review Proposed Item"
        titleId="review-item-title"
        isSubmitting={isSubmitting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
      >
        <div className="mb-4 border border-amber-500/20 bg-amber-500/10 rounded-lg p-4">
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
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Review this proposed item. You can edit any fields, select the status (Published or
              Draft), and then approve or delete it.
            </p>
          </div>
        </div>
        <ItemForm
          key={itemFormKey}
          initialData={formData}
          onSubmit={handleSubmit}
          onCancel={handleClose}
          submitLabel="Approve Item"
          submittingLabel="Approving..."
          isSubmitting={isSubmitting}
          mode="review"
          itemId={item._id}
          onFormChange={setHasUnsavedChanges}
          renderButtons={({ submitting, onCancel, submitLabel, submittingLabel }) => (
            <div className="flex flex-col gap-3 pt-4">
              <div className="flex gap-3">
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
              {onDelete && (
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="w-full px-4 py-2 border border-transparent bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
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
          pendingText="Deleting..."
          cancelText="Cancel"
          type="danger"
        />
      )}

      {/* Close Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirmClose}
        title="Discard Changes?"
        message="You have unsaved changes. Are you sure you want to close? All progress will be lost."
        onConfirm={handleConfirmClose}
        onCancel={() => setShowConfirmClose(false)}
        confirmText="Discard"
        cancelText="Cancel"
        type="warning"
      />
    </>
  );
}
