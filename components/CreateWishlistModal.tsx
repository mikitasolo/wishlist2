'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useToast } from './ToastProvider';
import ConfirmDialog from './ConfirmDialog';
import Icon from './Icon';
import ImageUpload from './ImageUpload';
import Select from './Select';
import { visibilityMeta, type Visibility } from '@/lib/utils/visibility';
import { currencySelectOptions } from '@/lib/utils/currencies';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';

interface CreateWishlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const defaultFormData = {
  name: '',
  description: '',
  visibility: 'everyone' as Visibility,
  bannerUrl: '',
  currency: 'USD',
};

export default function CreateWishlistModal({ isOpen, onClose }: CreateWishlistModalProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const { showToast } = useToast();
  const [formData, setFormData] = useState(defaultFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

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

  // Focus first input + prefill the currency from the user's default when opening.
  useEffect(() => {
    if (isOpen) {
      if (firstInputRef.current) setTimeout(() => firstInputRef.current?.focus(), 100);
      const cur = session?.user?.defaultCurrency || 'USD';
      setFormData((f) => ({ ...f, currency: cur }));
    }
  }, [isOpen, session?.user?.defaultCurrency]);

  // Prevent body scroll while the modal is open (shared, ref-counted lock)
  useBodyScrollLock(isOpen);

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
        router.push(`/wishlists/${result.data.slug ?? result.data._id}`);
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

  const handleClose = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  }, [hasUnsavedChanges, onClose]);

  const handleConfirmClose = () => {
    setShowConfirmClose(false);
    setHasUnsavedChanges(false);
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && !isSubmitting) {
      handleClose();
    }
  };

  // Handle Escape key press
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, isSubmitting, handleClose]);

  if (!isOpen) return null;

  // Rendered in a portal on <body> so the fixed overlay escapes any ancestor
  // with backdrop-filter/transform (e.g. the frosted header), which would
  // otherwise become its positioning container and mis-place it on scroll.
  return createPortal(
    <div
      className="animate-fade-in fixed left-0 right-0 top-0 z-50 flex h-[100dvh] items-center justify-center bg-slate-900/40 backdrop-blur-sm"
      onClick={handleBackdropClick}
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
      }}
    >
      <div
        className="animate-dialog-in flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-wishlist-title"
      >
        {/* Pinned header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <h2 id="create-wishlist-title" className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            Create new wishlist
          </h2>
          <button
            onClick={handleClose}
            className="-mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed"
            disabled={isSubmitting}
            aria-label="Close modal"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        {/* Scrollable body */}
        <form
          onSubmit={handleSubmit}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6"
          autoComplete="off"
        >
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">
              Wishlist Name *
            </label>
            <input
              type="text"
              id="name"
              required
              ref={firstInputRef}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-4 py-2 border border-border-strong rounded-xl outline-none"
              placeholder="My Wishlist"
              disabled={isSubmitting}
              aria-required="true"
              autoComplete="off"
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-foreground mb-1">
              Description
            </label>
            <textarea
              id="description"
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-4 py-2 border border-border-strong rounded-xl outline-none"
              placeholder="Optional description"
              rows={3}
              disabled={isSubmitting}
              autoComplete="off"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Currency</label>
            <Select
              value={formData.currency}
              onChange={(v) => setFormData({ ...formData, currency: v })}
              options={currencySelectOptions}
              ariaLabel="Wishlist currency"
              size="md"
              triggerClassName="w-full"
              disabled={isSubmitting}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Default currency for prices in this wishlist.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Banner image <span className="text-muted-foreground">(optional)</span>
            </label>
            <ImageUpload
              value={formData.bannerUrl || null}
              onChange={(url) => setFormData({ ...formData, bannerUrl: url ?? '' })}
              disabled={isSubmitting}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Used as the cover instead of the gradient.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Visibility</label>
            <p className="mb-2 text-xs text-muted-foreground">
              {formData.visibility === 'everyone'
                ? 'Anyone can find and view this wishlist.'
                : formData.visibility === 'friends'
                  ? 'Only your friends (mutual follows) and members can view it.'
                  : 'Only you and people you invite can view it.'}
            </p>
            <div className="relative flex rounded-xl border border-border bg-surface-2 p-1">
              <span
                aria-hidden
                className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
                style={{
                  width: 'calc((100% - 0.5rem) / 3)',
                  left: `calc(${['everyone', 'friends', 'private'].indexOf(formData.visibility)} * ((100% - 0.5rem) / 3) + 0.25rem)`,
                }}
              />
              {(['everyone', 'friends', 'private'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFormData({ ...formData, visibility: v })}
                  disabled={isSubmitting}
                  className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    formData.visibility === v
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon name={visibilityMeta[v].icon} size={14} />
                  {v === 'private' ? 'Only me' : visibilityMeta[v].label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-2 border border-border-strong text-foreground rounded-xl hover:bg-surface-hover transition-colors font-medium cursor-pointer"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 border border-transparent bg-primary-600 text-white rounded-xl hover:bg-primary-700 transition-colors font-medium disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Wishlist'}
            </button>
          </div>
        </form>
      </div>

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
    </div>,
    document.body
  );
}
