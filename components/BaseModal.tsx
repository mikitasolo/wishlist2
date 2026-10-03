'use client';

import { useEffect, useCallback, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/Icon';
import IconButton from '@/components/IconButton';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  children: ReactNode;
  isSubmitting?: boolean;
  // Optional: function to check if close should be intercepted
  shouldInterceptClose?: () => boolean;
  // Optional: function to handle intercepted close (e.g., show confirmation)
  onInterceptClose?: () => void;
  /**
   * A step back, shown above the title ("‹ Change list"), for a dialog that is
   * one step of a flow. Disabled while submitting, like the close button.
   */
  back?: { label: string; onClick: () => void };
}

export default function BaseModal({
  isOpen,
  onClose,
  title,
  titleId,
  children,
  isSubmitting = false,
  shouldInterceptClose,
  onInterceptClose,
  back,
}: BaseModalProps) {
  const handleClose = useCallback(() => {
    if (shouldInterceptClose && shouldInterceptClose() && onInterceptClose) {
      onInterceptClose();
    } else {
      onClose();
    }
  }, [shouldInterceptClose, onInterceptClose, onClose]);

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

  // Prevent body scroll while the modal is open (shared, ref-counted lock)
  useBodyScrollLock(isOpen);

  // Focus starts on the close button (unless the content has an `autoFocus`),
  // stays inside while it's open, and goes back on close. While a submit has
  // the form disabled, it's held on the panel, then goes back to the control
  // that had it (the submit button, after a failed save).
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(isOpen, dialogRef, closeButtonRef, { busy: isSubmitting });

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && !isSubmitting) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    // Height is pinned to the dynamic viewport (dvh) so the box always fits the
    // *visible* area on mobile — where a `vh`/`inset-0`-sized box overflows behind
    // the browser chrome. The dialog fills almost all of that with small margins,
    // its header stays put, and the body scrolls internally.
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
        ref={dialogRef}
        tabIndex={-1}
        className="animate-dialog-in flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* Pinned header */}
        <div className="flex flex-shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div className="min-w-0">
            {back && (
              <button
                type="button"
                onClick={back.onClick}
                disabled={isSubmitting}
                className="-ml-1.5 mb-1 inline-flex items-center gap-0.5 rounded-md py-0.5 pl-0.5 pr-1.5 text-sm font-medium text-accent transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="chevron-left" size={16} />
                {back.label}
              </button>
            )}
            <h2
              id={titleId}
              className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl"
            >
              {title}
            </h2>
          </div>
          <IconButton
            ref={closeButtonRef}
            icon="close"
            label="Close modal"
            onClick={handleClose}
            disabled={isSubmitting}
            className="-mr-1"
          />
        </div>
        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
