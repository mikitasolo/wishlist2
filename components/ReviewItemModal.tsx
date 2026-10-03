'use client';

import { useState, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import BaseModal from './BaseModal';
import Button from './Button';
import ItemForm, { itemToFormData } from './ItemForm';
import ConfirmDialog from './ConfirmDialog';
import { defaultItemCurrency } from '@/lib/utils/currencies';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import { STATUS_META } from '@/lib/utils/itemStatus';

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
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const locale = useViewerLocale();

  // Reset states when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setIsDeleting(false);
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
  // Until then the confirmation shows the delete running and takes no second click.
  const handleDelete = async () => {
    if (!onDelete) return;
    setIsDeleting(true);
    try {
      await onDelete();
      setHasUnsavedChanges(false);
      onClose();
    } catch (error) {
      console.error('Error deleting item:', error);
    } finally {
      setShowDeleteConfirm(false);
      setIsDeleting(false);
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
  // The price field is filled in the format the item's card shows it in.
  const formData = itemToFormData(
    item,
    defaultItemCurrency(wishlistCurrency, userCurrency),
    locale
  );
  formData.isDraft = false; // Default to published when reviewing

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title="Review proposed item"
        titleId="review-item-title"
        isSubmitting={isSubmitting || isDeleting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
      >
        <div className={`mb-4 rounded-lg p-4 ${STATUS_META.proposed.classes.notice}`}>
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
          submitLabel="Approve item"
          submittingLabel="Approving…"
          isSubmitting={isSubmitting || isDeleting}
          mode="review"
          itemId={item._id}
          onFormChange={setHasUnsavedChanges}
          renderButtons={({ submitting, onCancel, submitLabel, submittingLabel }) => (
            <div className="flex flex-col gap-3 pt-4">
              <div className="flex gap-3">
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
                  {/* A delete disables the form too, but only an approve reads "Approving…". */}
                  {isSubmitting ? submittingLabel : submitLabel}
                </Button>
              </div>
              {onDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={submitting}
                  fullWidth
                >
                  Delete item
                </Button>
              )}
            </div>
          )}
        />
      </BaseModal>

      {/* Delete Confirmation Dialog */}
      {onDelete && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="Delete proposed item"
          message="Are you sure you want to delete this proposed item? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmText="Delete"
          pendingText="Deleting…"
          cancelText="Cancel"
          type="danger"
        />
      )}

      {/* Close Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showConfirmClose}
        title="Discard changes?"
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
