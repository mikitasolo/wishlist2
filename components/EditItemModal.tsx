'use client';

import { useState, useEffect, useId } from 'react';
import { ApiItem } from '@/types/api';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ItemFormFooter from './ItemFormFooter';
import ConfirmDialog from './ConfirmDialog';
import { defaultItemCurrency } from '@/lib/utils/currencies';
import type { ItemContentChanges } from '@/lib/utils/itemForm';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';

interface EditItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Given only the fields the user changed, and never called when there are
  // none. Must reject when the request fails: the modal only closes on success,
  // so the user's changes survive a failure.
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
  const formId = useId();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  // The price field is filled in the format the item's card shows it in.
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
  const itemFormKey = isOpen ? `edit-item-${item._id}` : undefined;

  // Sends only what the owner changed from the item the form was filled from
  // (see itemChanges): a co-owner may have saved the item since the modal
  // opened, and a field sent as it was loaded would write that back over their
  // change. Above all an unchanged image, which would put back one their
  // replacement has already freed, and free theirs.
  const handleSubmit = async (_data: unknown, changes: ItemContentChanges) => {
    // A name emptied to blanks isn't sent, so the item keeps its name.
    const { name, ...rest } = changes;
    // Editing content never changes status — that would silently clobber a
    // booking (owners can't see bookings). Publishing / moving to draft is a
    // separate, explicit action on the item card, and itemChanges leaves it out.
    const updates: Partial<ApiItem> = name ? changes : rest;
    if (Object.keys(updates).length === 0) {
      // Nothing to save (the API would refuse an empty update): just close.
      setHasUnsavedChanges(false);
      onClose();
      return;
    }

    setIsSubmitting(true);
    // No catch: a failed save must reject through to ItemForm, which then keeps
    // comparing the user's changes against the saved item. Only a success
    // closes the modal.
    try {
      await onSave(updates);
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

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title={item.status === 'proposed' ? 'Edit proposed item' : 'Edit item'}
        titleId="edit-item-title"
        isSubmitting={isSubmitting || isDeleting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
        footer={
          <ItemFormFooter
            formId={formId}
            busy={isSubmitting || isDeleting}
            // A delete disables the form too, but only a save reads "Saving…".
            saving={isSubmitting}
            onCancel={handleClose}
            submitLabel="Save"
            submittingLabel="Saving…"
            onDelete={onDelete ? () => setShowDeleteConfirm(true) : undefined}
          />
        }
      >
        <ItemForm
          key={itemFormKey}
          initialData={itemToFormData(
            item,
            defaultItemCurrency(wishlistCurrency, userCurrency),
            locale
          )}
          onSubmit={handleSubmit}
          onCancel={handleClose}
          mode={item.status === 'proposed' ? 'propose' : 'edit'}
          itemId={item._id}
          onFormChange={setHasUnsavedChanges}
          isSubmitting={isSubmitting || isDeleting}
          formId={formId}
        />
      </BaseModal>

      {/* Delete Confirmation Dialog */}
      {onDelete && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="Delete item"
          message="Are you sure you want to delete this item? This action cannot be undone."
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
