'use client';

import { useState, useEffect } from 'react';
import BaseModal from './BaseModal';
import ItemForm from './ItemForm';

interface ProposeItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPropose: (item: {
    name: string;
    imageUrl?: string;
    priceInCents?: number;
    link?: string;
    notes?: string;
    status: 'proposed';
  }) => Promise<void>;
}

export default function ProposeItemModal({ isOpen, onClose, onPropose }: ProposeItemModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset submitting state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setIsSubmitting(false);
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
      // In propose mode, status will always be 'proposed'
      if (data.status !== 'proposed') {
        throw new Error('Expected proposed status in propose mode');
      }
      await onPropose({
        ...data,
        status: 'proposed',
      });
      onClose();
    } catch (error) {
      console.error('Error proposing item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Propose New Item"
      titleId="propose-item-title"
      isSubmitting={isSubmitting}
    >
      <ItemForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        submitLabel="Propose Item"
        submittingLabel="Proposing..."
        isSubmitting={isSubmitting}
        mode="propose"
      />
    </BaseModal>
  );
}
