'use client';

import { useState, useEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from './ToastProvider';
import BaseModal from './BaseModal';
import ConfirmDialog from './ConfirmDialog';
import SegmentedControl from './SegmentedControl';
import ImageUpload from './ImageUpload';
import Select from './Select';
import Button from './Button';
import Field from './Field';
import Input from './Input';
import Textarea from './Textarea';
import { FIELD_HELPER, FIELD_LABEL } from './fieldStyles';
import { visibilityMeta, VISIBILITY_OPTIONS, type Visibility } from '@/lib/utils/visibility';
import { currencySelectOptions } from '@/lib/utils/currencies';

/** The new list, as `POST /api/wishlists` answers it: the fields a caller of `onCreated` reads. */
export interface CreatedWishlist {
  _id: string;
  name: string;
  slug?: string | null;
  currency?: string | null;
}

interface CreateWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called with the new list once it's created, after `onClose`, instead of
   * going to its page: for a flow that carries on with it where it is ("Save
   * to my list" saves the item to it).
   */
  onCreated?: (wishlist: CreatedWishlist) => void;
}

const defaultFormData = {
  name: '',
  description: '',
  visibility: 'everyone' as Visibility,
  bannerUrl: '',
  currency: 'USD',
};

export default function CreateWishlistModal({
  isOpen,
  onClose,
  onCreated,
}: CreateWishlistModalProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [formData, setFormData] = useState(defaultFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const visibilityLabelId = useId();
  const visibilityHelperId = useId();

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setFormData(defaultFormData);
      setHasUnsavedChanges(false);
      setShowConfirmClose(false);
    }
  }, [isOpen]);

  // Check if form has changes
  useEffect(() => {
    const hasChanges =
      formData.name !== defaultFormData.name ||
      formData.description !== defaultFormData.description ||
      formData.visibility !== defaultFormData.visibility ||
      formData.bannerUrl !== defaultFormData.bannerUrl;
    setHasUnsavedChanges(hasChanges);
  }, [formData]);

  // Prefill the currency from the user's default when opening.
  useEffect(() => {
    if (isOpen) {
      const cur = session?.user?.defaultCurrency || 'USD';
      setFormData((f) => ({ ...f, currency: cur }));
    }
  }, [isOpen, session?.user?.defaultCurrency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch('/api/wishlists', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        showToast('Wishlist created successfully', 'success');
        setHasUnsavedChanges(false);
        onClose();
        const created = result.data as CreatedWishlist;
        if (onCreated) onCreated(created);
        else router.push(`/wishlists/${created.slug ?? created._id}`);
      } else {
        showToast(result.error || 'Failed to create wishlist', 'error');
      }
    } catch (error) {
      console.error('Error creating wishlist:', error);
      showToast('Failed to create wishlist', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Escape, the backdrop and the close button ask before throwing away what's
  // been typed (BaseModal's intercept), and so does Cancel.
  const hasChanges = useCallback(() => hasUnsavedChanges, [hasUnsavedChanges]);
  const confirmClose = useCallback(() => setShowConfirmClose(true), []);
  const handleClose = () => {
    if (hasUnsavedChanges) confirmClose();
    else onClose();
  };

  const handleConfirmClose = () => {
    setShowConfirmClose(false);
    setHasUnsavedChanges(false);
    onClose();
  };

  return (
    <>
      {/* Focus starts on the name field (its autoFocus), stays inside while
          it's open (the currency menu included), and goes back on close.
          While the form submits, it's held on the panel, then goes back to the
          control that had it if the submit fails. */}
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="Create new wishlist"
        titleId="create-wishlist-title"
        size="md"
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
        shouldInterceptClose={hasChanges}
        onInterceptClose={confirmClose}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={handleClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating…' : 'Create wishlist'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Wishlist name *" id="name">
            <Input
              required
              autoFocus
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My wishlist"
              disabled={isSubmitting}
              aria-required="true"
              autoComplete="off"
            />
          </Field>

          <Field label="Description" id="description">
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional description"
              rows={3}
              disabled={isSubmitting}
              autoComplete="off"
            />
          </Field>

          <div>
            <label className={FIELD_LABEL}>Currency</label>
            <Select
              value={formData.currency}
              onChange={(v) => setFormData({ ...formData, currency: v })}
              options={currencySelectOptions}
              ariaLabel="Wishlist currency"
              size="md"
              triggerClassName="w-full"
              disabled={isSubmitting}
            />
            <p className={FIELD_HELPER}>Default currency for prices in this wishlist.</p>
          </div>

          <div>
            <label className={FIELD_LABEL}>
              Banner image <span className="text-muted-foreground">(optional)</span>
            </label>
            {/* An upload lands after the render that started it: update the form as it is by then. */}
            <ImageUpload
              value={formData.bannerUrl || null}
              onChange={(url) => setFormData((f) => ({ ...f, bannerUrl: url ?? '' }))}
              disabled={isSubmitting}
            />
            <p className={FIELD_HELPER}>Used as the cover instead of the gradient.</p>
          </div>

          <div>
            <span id={visibilityLabelId} className={FIELD_LABEL}>
              Visibility
            </span>
            <p id={visibilityHelperId} className="mb-1.5 text-xs text-muted-foreground">
              {visibilityMeta[formData.visibility].helper}
            </p>
            <SegmentedControl
              ariaLabelledBy={visibilityLabelId}
              ariaDescribedBy={visibilityHelperId}
              value={formData.visibility}
              onChange={(visibility) => setFormData((f) => ({ ...f, visibility }))}
              disabled={isSubmitting}
              options={VISIBILITY_OPTIONS}
            />
          </div>
        </div>
      </BaseModal>

      {/* On <body>, as BaseModal is: rendered in place, it would be drawn
          inside whatever contains this modal (the header's frosted bar), under
          the modal's backdrop. */}
      {showConfirmClose &&
        createPortal(
          <ConfirmDialog
            isOpen
            title="Discard changes?"
            message="You have unsaved changes. Are you sure you want to close? All progress will be lost."
            onConfirm={handleConfirmClose}
            onCancel={() => setShowConfirmClose(false)}
            confirmText="Discard"
            cancelText="Cancel"
            type="warning"
          />,
          document.body
        )}
    </>
  );
}
