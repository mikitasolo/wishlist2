'use client';

import { useState, useEffect, useId, useRef } from 'react';
import { ApiItem } from '@/types/api';
import BaseModal from './BaseModal';
import ItemForm, { itemToFormData } from './ItemForm';
import ItemFormFooter from './ItemFormFooter';
import ConfirmDialog from './ConfirmDialog';
import Callout from './Callout';
import { PROPOSAL_EDITED_ERROR } from '@/lib/utils/proposalReview';
import { defaultItemCurrency } from '@/lib/utils/currencies';
import type { ItemContentChanges } from '@/lib/utils/itemForm';
import { useViewerLocale } from '@/lib/hooks/useViewerLocale';

interface ReviewItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Given the status of the button pressed and only the content the owner
  // changed. Must reject when the request fails: the modal only closes on
  // success, so the owner's edits survive a failure.
  onApprove: (updates: Partial<ApiItem> & { status: 'draft' | 'available' }) => Promise<void>;
  // Declines the proposal: deletes it. Must reject when that fails.
  onDelete?: () => Promise<void>;
  // The proposal as last read. A later version of it (the proposer edited it
  // while the dialog was open, WIS-320) refills the fields the owner hasn't
  // changed and shows a notice; the owner's own edits are kept.
  item: ApiItem;
  // Where the proposal stands in the list as last read (proposalReviewState).
  // Once it isn't a proposal any more (a co-owner reviewed it, or it was
  // declined or withdrawn), the dialog asks to be closed through
  // onProposalGone, unless its own approve or Decline is running, which
  // changes the item itself (WIS-199).
  proposalState?: 'proposed' | 'reviewed' | 'gone';
  onProposalGone?: (state: 'reviewed' | 'gone') => void;
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
  proposalState = 'proposed',
  onProposalGone,
  wishlistCurrency,
  userCurrency,
}: ReviewItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Whether the approve running is Add as draft's, which then reads "Adding…".
  const [savingDraft, setSavingDraft] = useState(false);
  const formId = useId();
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const locale = useViewerLocale();
  // Set once this dialog's own approve or Decline has landed: the item has
  // changed because of it, so a read showing that isn't news to report.
  const answeredRef = useRef(false);
  // The version of the proposal the dialog opened on: a later one shown means
  // the proposer edited it while it was open (WIS-320).
  const [openedVersion, setOpenedVersion] = useState<string | null>(null);
  if (isOpen && openedVersion === null) setOpenedVersion(item.updatedAt);
  if (!isOpen && openedVersion !== null) setOpenedVersion(null);
  const editedWhileOpen = isOpen && openedVersion !== null && item.updatedAt !== openedVersion;

  // Reset states when modal closes
  useEffect(() => {
    if (!isOpen) {
      answeredRef.current = false;
      setIsSubmitting(false);
      setIsDeleting(false);
      setShowDeleteConfirm(false);
      setHasUnsavedChanges(false);
      setShowConfirmClose(false);
    }
  }, [isOpen]);

  // The dialog is a snapshot of the proposal as it opened. Once a read shows
  // it's no longer one, approving or declining from here would act on an item
  // the owner never reviewed, so the dialog goes, its edits with it, and the
  // page says why. Not while this dialog's own request runs, nor once it has
  // landed: its optimistic update already shows the item approved or gone, and
  // it closes the dialog itself.
  const busy = isSubmitting || isDeleting;
  useEffect(() => {
    if (isOpen && !busy && !answeredRef.current && proposalState !== 'proposed') {
      onProposalGone?.(proposalState);
    }
  }, [isOpen, busy, proposalState, onProposalGone]);

  // Use key prop to force ItemForm to remount when modal opens with a different item
  // This ensures form state is reset when switching between items
  const itemFormKey = isOpen ? `review-item-${item._id}` : undefined;

  // Approves the proposal as the button pressed says: Add to list makes it
  // live, Add as draft a draft. It sends that status and only the content the
  // owner changed from the proposal as the dialog opened on it (see
  // itemChanges), as an edit does: a field they didn't touch stays out of the
  // write, so it can't put back what the proposer (or a co-owner) changed since.
  // The server clears the proposer when it approves.
  const handleSubmit = async (
    data: { status: 'draft' | 'available' | 'proposed' },
    changes: ItemContentChanges
  ) => {
    // In review mode the status is always 'draft' or 'available'.
    if (data.status === 'proposed') throw new Error('Cannot approve item with proposed status');
    // A name emptied to blanks isn't sent (the form refuses it anyway).
    const { name, ...rest } = changes;
    const updates: Partial<ApiItem> & { status: 'draft' | 'available' } = {
      ...(name ? changes : rest),
      status: data.status,
    };
    setSavingDraft(data.status === 'draft');
    setIsSubmitting(true);
    // No catch: a failed approve must reject through to ItemForm, so it keeps
    // the proposal as its unsaved-changes baseline. Only a success closes the modal.
    try {
      await onApprove(updates);
      answeredRef.current = true;
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
      answeredRef.current = true;
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

  // The form is filled from the proposal, in the format its card shows the price in.
  const formData = itemToFormData(
    item,
    defaultItemCurrency(wishlistCurrency, userCurrency),
    locale
  );

  // The title never names the proposer: proposals are anonymous to the owners.
  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={handleClose}
        title="Someone proposed an item"
        titleId="review-item-title"
        isSubmitting={isSubmitting || isDeleting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
        footer={
          <ItemFormFooter
            formId={formId}
            busy={isSubmitting || isDeleting}
            // A decline holds the buttons too, but only an approve reads "Adding…".
            saving={isSubmitting}
            savingDraft={savingDraft}
            onCancel={handleClose}
            submitLabel="Add to list"
            submittingLabel="Adding…"
            saveAsDraft
            draftLabel="Add as draft"
            draftSubmittingLabel="Adding…"
            onDelete={onDelete ? () => setShowDeleteConfirm(true) : undefined}
            deleteLabel="Decline"
          />
        }
      >
        {editedWhileOpen && (
          <Callout tone="warning" className="mb-4">
            {PROPOSAL_EDITED_ERROR}
          </Callout>
        )}
        <ItemForm
          key={itemFormKey}
          initialData={formData}
          // A new version of the proposal refills what the owner hasn't changed.
          rebaseVersion={item.updatedAt}
          onSubmit={handleSubmit}
          onCancel={handleClose}
          isSubmitting={isSubmitting || isDeleting}
          mode="review"
          itemId={item._id}
          onFormChange={setHasUnsavedChanges}
          formId={formId}
        />
      </BaseModal>

      {/* Decline confirmation. Declining deletes the proposal, as an owner's
          delete of any item does, and tells the proposer nothing (D12). */}
      {onDelete && (
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          title="Decline this proposal?"
          message="It's removed from the list."
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
          confirmText="Decline"
          pendingText="Declining…"
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
