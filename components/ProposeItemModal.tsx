'use client';

import { useState, useEffect } from 'react';
import BaseModal from './BaseModal';
import ItemForm from './ItemForm';
import ConfirmDialog from './ConfirmDialog';

interface ProposeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPropose: (item: {
    name: string;
    imageUrl?: string;
    price?: { value: number; currency: string } | null;
    link?: string;
    notes?: string;
    status: 'proposed';
  }) => Promise<void>;
}

export default function ProposeItemModal({ isOpen, onClose, onPropose }: ProposeItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);

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
    imageUrl?: string;
    price?: { value: number; currency: string } | null;
    link?: string;
    notes?: string;
    status: 'draft' | 'available' | 'proposed';
  }) => {
    setIsSubmitting(true);
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
      onClose();
    } catch (error) {
      console.error('Error proposing item:', error);
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
        title="Propose New Item"
        titleId="propose-item-title"
        isSubmitting={isSubmitting}
        shouldInterceptClose={() => hasUnsavedChanges}
        onInterceptClose={() => setShowConfirmClose(true)}
      >
        <ItemForm
          onSubmit={handleSubmit}
          onCancel={handleClose}
          submitLabel="Propose Item"
          submittingLabel="Proposing..."
          isSubmitting={isSubmitting}
          mode="propose"
          onFormChange={setHasUnsavedChanges}
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
