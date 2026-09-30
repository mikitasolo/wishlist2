'use client';

import { useState, useEffect } from 'react';
import { ApiItem } from '@/types/api';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ConfirmDialog from './ConfirmDialog';
import { defaultItemCurrency } from '@/lib/utils/currencies';

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Must reject when the request fails: the modal only closes on success, so
  // the user's changes survive a failure.
  onSave: (updates: Partial<ApiItem>) => Promise<void>;
  onDelete?: () => Promise<void>;
  item: ApiItem;
  // A priceless item's currency starts on the wishlist's, else the viewer's
  // default, else USD. Required (though either may be empty) so a caller can't
  // silently drop them and fall back to USD.
  wishlistCurrency: string | null | undefined;
  userCurrency: string | null | undefined;
}

export default function EditItemModal({
  isOpen,
  onClose,
  onSave,
  onDelete,
  item,
  wishlistCurrency,
  userCurrency,
}: EditItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

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
  const itemFormKey = isOpen ? `edit-item-${item._id}` : undefined;

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
    // No catch: a failed save must reject through to ItemForm, which then keeps
    // comparing the user's changes against the saved item. Only a success
    // closes the modal.
    try {
      const updates: Partial<ApiItem> = {
        name: data.name || undefined,
        // Include fields even if null to clear them
        imageUrl: data.imageUrl !== undefined ? data.imageUrl : undefined,
        price: data.price !== undefined ? data.price : undefined,
        link: data.link !== undefined ? data.link : undefined,
        notes: data.notes !== undefined ? data.notes : undefined,
        // Absent when a proposer edits their own proposal.
        mostWanted: data.mostWanted,
      };
      // Editing content never changes status — that would silently clobber a
      // booking (owners can't see bookings). Publishing / moving to draft is a
      // separate, explicit action on the item card.
      await onSave(updates);
      setHasUnsavedChanges(false);
      onClose();
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
      setHasUnsavedChanges(false);
      onClose();
    } catch (error) {
      console.error('Error deleting item:', error);
    } finally {
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

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title={item.status === 'proposed' ? 'Edit Proposed Item' : 'Edit Item'}
        titleId="edit-item-title"
        isSubmitting={isSubmitting || isDeleting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
      >
        <ItemForm
          key={itemFormKey}
          initialData={itemToFormData(item, defaultItemCurrency(wishlistCurrency, userCurrency))}
          onSubmit={handleSubmit}
          onCancel={handleClose}
          submitLabel="Save Changes"
          submittingLabel="Saving..."
          isSubmitting={isSubmitting || isDeleting}
          mode={item.status === 'proposed' ? 'propose' : 'edit'}
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
          title="Delete Item"
          message="Are you sure you want to delete this item? This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmText="Delete"
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
