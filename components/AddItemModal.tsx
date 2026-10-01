'use client';

import { useState, useEffect } from 'react';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ConfirmDialog from './ConfirmDialog';
import { defaultItemCurrency } from '@/lib/utils/currencies';
import type { ApiItem } from '@/types/api';

/** What a copy of an item ("Save to my list") starts from. */
export type ItemPrefill = Pick<ApiItem, 'name' | 'imageUrl' | 'price' | 'link'>;

/** The new item the modal submits. */
export interface NewItemData {
  name: string;
  imageUrl?: string;
  price?: { value: number; currency: string } | null;
  link?: string;
  notes?: string;
  mostWanted?: boolean;
  status?: 'draft' | 'available';
}

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Must reject when the request fails: the modal only closes on success, so
  // the user's input survives a failure.
  onAdd: (item: NewItemData) => Promise<void>;
  // The new item's currency starts on the wishlist's, else the viewer's default,
  // else USD. Required (though either may be empty) so a caller can't silently
  // drop them and fall back to USD.
  wishlistCurrency: string | null | undefined;
  userCurrency: string | null | undefined;
  // Prefills the form for a copy of an item: its name, price and currency, link
  // and image. Never its notes (the source owner's hints), flag or status, which
  // start fresh. Read when the modal mounts.
  initialItem?: ItemPrefill;
  title?: string;
}

export default function AddItemModal({
  isOpen,
  onClose,
  onAdd,
  wishlistCurrency,
  userCurrency,
  initialItem,
  title = 'Add New Item',
}: AddItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

  const defaultCurrency = defaultItemCurrency(wishlistCurrency, userCurrency);
  // Only the copied fields come across; the rest is a new item's. A stable
  // snapshot, so nothing the caller re-renders with resets the user's edits.
  const [initialData] = useState(() =>
    initialItem
      ? itemToFormData(
          {
            name: initialItem.name,
            imageUrl: initialItem.imageUrl,
            price: initialItem.price,
            link: initialItem.link,
            notes: null,
            mostWanted: false,
            status: 'available',
          },
          defaultCurrency
        )
      : undefined
  );

  // Reset submitting state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setHasUnsavedChanges(false);
      setShowConfirmClose(false);
    }
  }, [isOpen]);

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
    // No catch: a failed add must reject through to ItemForm, which then keeps
    // what the user typed. Only a success closes the modal.
    try {
      // In create mode, status will always be 'draft' or 'available', never 'proposed'
      if (data.status === 'proposed') {
        throw new Error('Cannot create item with proposed status');
      }
      // A prefilled form submits a cleared field as null (as an edit would), but
      // a new item just leaves it out.
      await onAdd({
        ...data,
        imageUrl: data.imageUrl || undefined,
        link: data.link || undefined,
        notes: data.notes || undefined,
        status: data.status,
      });
      setHasUnsavedChanges(false);
      onClose();
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
        title={title}
        titleId="add-item-title"
        isSubmitting={isSubmitting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
      >
        <ItemForm
          initialData={initialData}
          onSubmit={handleSubmit}
          onCancel={handleClose}
          submitLabel="Add Item"
          submittingLabel="Adding..."
          isSubmitting={isSubmitting}
          onFormChange={setHasUnsavedChanges}
          defaultCurrency={defaultCurrency}
        />
      </BaseModal>

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
