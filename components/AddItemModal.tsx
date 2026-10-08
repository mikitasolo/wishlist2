'use client';

import { useState, useEffect, useId } from 'react';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ItemFormFooter from './ItemFormFooter';
import ConfirmDialog from './ConfirmDialog';
import { defaultItemCurrency } from '@/lib/utils/currencies';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';
import type { ApiItem } from '@/types/api';
import type { ItemRef } from '@/lib/utils/itemLinks';

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
  /** The items on the list it goes with (WIS-29). */
  linkItems?: string[];
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
  // A step back in the flow this form is part of ("‹ Change list" in Save to my
  // list), shown in the header. Like closing, it asks first if there are
  // unsaved changes, since the form and its edits go.
  back?: { label: string; onBack: () => void };
  // The list's items the new one can go with (WIS-29): shows "Goes with".
  // Never for a copy of an item, whose list may be another.
  linkOptions?: readonly ItemRef[];
}

export default function AddItemModal({
  isOpen,
  onClose,
  onAdd,
  wishlistCurrency,
  userCurrency,
  initialItem,
  title = 'Add new item',
  back,
  linkOptions,
}: AddItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const formId = useId();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  // Where to go once the user confirms discarding their changes: closing the
  // modal, or the step back. Null while no confirmation is open.
  const [confirmLeave, setConfirmLeave] = useState<'close' | 'back' | null>(null);
  // Keep adding: a save clears the form for the next item instead of closing.
  // Off each time the modal opens. Not offered for a copy of an item, which is
  // one item by nature.
  const [keepAdding, setKeepAdding] = useState(false);

  const defaultCurrency = defaultItemCurrency(wishlistCurrency, userCurrency);
  // A copied price is filled in the format the item's card shows it in.
  const locale = useViewerLocale();
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
          defaultCurrency,
          locale
        )
      : undefined
  );

  // Reset submitting state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
      setHasUnsavedChanges(false);
      setConfirmLeave(null);
      setKeepAdding(false);
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
    linkItems?: string[];
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
      // With Keep adding on, the form clears itself and stays (see ItemForm).
      if (!keepAdding) onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setConfirmLeave('close');
    } else {
      onClose();
    }
  };

  const handleBack = () => {
    if (hasUnsavedChanges) setConfirmLeave('back');
    else back?.onBack();
  };

  const handleConfirmLeave = () => {
    const leave = confirmLeave;
    setConfirmLeave(null);
    setHasUnsavedChanges(false);
    if (leave === 'back') back?.onBack();
    else onClose();
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
        onInterceptClose={() => setConfirmLeave('close')}
        back={back && { label: back.label, onClick: handleBack }}
        footer={
          <ItemFormFooter
            formId={formId}
            busy={isSubmitting}
            saving={isSubmitting}
            onCancel={handleClose}
            submitLabel="Add to list"
            submittingLabel="Adding…"
            saveAsDraft
            keepAdding={initialItem ? undefined : { checked: keepAdding, onChange: setKeepAdding }}
          />
        }
      >
        <ItemForm
          initialData={initialData}
          onSubmit={handleSubmit}
          onCancel={handleClose}
          isSubmitting={isSubmitting}
          onFormChange={setHasUnsavedChanges}
          defaultCurrency={defaultCurrency}
          formId={formId}
          linkOptions={linkOptions}
        />
      </BaseModal>

      <ConfirmDialog
        isOpen={confirmLeave !== null}
        title="Discard changes?"
        message={
          confirmLeave === 'back'
            ? 'You have unsaved changes. Are you sure you want to go back? All progress will be lost.'
            : 'You have unsaved changes. Are you sure you want to close? All progress will be lost.'
        }
        onConfirm={handleConfirmLeave}
        onCancel={() => setConfirmLeave(null)}
        confirmText="Discard"
        cancelText="Cancel"
        type="warning"
      />
    </>
  );
}
