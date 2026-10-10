'use client';

import { useState, useEffect, useId } from 'react';
import BaseModal from './BaseModal';
import ItemForm from './ItemForm';
import ItemFormFooter, { KeepAddingToggle } from './ItemFormFooter';
import ConfirmDialog from './ConfirmDialog';
import { defaultItemCurrency } from '@/lib/utils/currencies';

interface ProposeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Must reject when the request fails: the modal only closes on success, so
  // the user's input survives a failure.
  onPropose: (item: {
    name: string;
    imageUrl?: string | null;
    price?: { value: number; currency: string } | null;
    link?: string | null;
    notes?: string | null;
    status: 'proposed';
  }) => Promise<void>;
  // The new item's currency starts on the wishlist's, else the viewer's default,
  // else USD. Required (though either may be empty) so a caller can't silently
  // drop them and fall back to USD.
  wishlistCurrency: string | null | undefined;
  userCurrency: string | null | undefined;
}

export default function ProposeItemModal({
  isOpen,
  onClose,
  onPropose,
  wishlistCurrency,
  userCurrency,
}: ProposeItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formId = useId();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  // Keep adding: a save clears the form for the next proposal instead of
  // closing. Off each time the modal opens.
  const [keepAdding, setKeepAdding] = useState(false);

  // Reset submitting state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setHasUnsavedChanges(false);
      setShowConfirmClose(false);
      setKeepAdding(false);
    }
  }, [isOpen]);

  const handleSubmit = async (data: {
    name: string;
    imageUrl?: string | null;
    price?: { value: number; currency: string } | null;
    link?: string | null;
    notes?: string | null;
    status: 'draft' | 'available' | 'proposed';
  }) => {
    setIsSubmitting(true);
    // No catch: a failed proposal must reject through to ItemForm, which then
    // keeps what the user typed. Only a success closes the modal.
    try {
      // In propose mode, status will always be 'proposed'
      if (data.status !== 'proposed') {
        throw new Error('Expected proposed status in propose mode');
      }
      await onPropose({
        ...data,
        status: 'proposed',
      });
      setHasUnsavedChanges(false);
      // With Keep adding on, the form clears itself and stays (see ItemForm).
      if (!keepAdding) onClose();
    } finally {
      setIsSubmitting(false);
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
        title="Propose new item"
        titleId="propose-item-title"
        isSubmitting={isSubmitting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
        footer={
          <ItemFormFooter
            formId={formId}
            busy={isSubmitting}
            saving={isSubmitting}
            onCancel={handleClose}
            submitLabel="Propose"
            submittingLabel="Proposing…"
          />
        }
      >
        <ItemForm
          onSubmit={handleSubmit}
          onCancel={handleClose}
          isSubmitting={isSubmitting}
          mode="propose"
          onFormChange={setHasUnsavedChanges}
          defaultCurrency={defaultItemCurrency(wishlistCurrency, userCurrency)}
          formId={formId}
        />
        <KeepAddingToggle checked={keepAdding} onChange={setKeepAdding} disabled={isSubmitting} />
      </BaseModal>

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
