'use client';

import { useState, useEffect } from 'react';
import BaseModal from './BaseModal';
import ItemForm from './ItemForm';

interface AddItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (item: {
    name: string;
    imageUrl?: string;
    priceInCents?: number;
    link?: string;
    notes?: string;
    status?: 'draft' | 'available';
  }) => Promise<void>;
}

export default function AddItemModal({ isOpen, onClose, onAdd }: AddItemModalProps) {
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
    status: 'draft' | 'available';
  }) => {
    setIsSubmitting(true);
    try {
      await onAdd(data);
      onClose();
    } catch (error) {
      console.error('Error adding item:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Add New Item"
      titleId="add-item-title"
      isSubmitting={isSubmitting}
    >
      <ItemForm
        onSubmit={handleSubmit}
        onCancel={onClose}
        submitLabel="Add Item"
        submittingLabel="Adding..."
        isSubmitting={isSubmitting}
      />
    </BaseModal>
  );
}

