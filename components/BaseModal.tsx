'use client';

import { useEffect, useCallback, useRef, type FormEventHandler, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/Icon';
import IconButton from '@/components/IconButton';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

/** A dialog's width: sm 24rem, md 28rem, lg 32rem. */
export type ModalSize = 'sm' | 'md' | 'lg';

const sizeStyles: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
};

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  children: ReactNode;
  /** sm 24rem, md 28rem, or lg 32rem (the default). */
  size?: ModalSize;
  /**
   * Pinned under the scrolling body, right-aligned: Cancel first, then the
   * primary action. Inside the dialog, so its focus trap counts its buttons.
   */
  footer?: ReactNode;
  /**
   * Pinned in the header, under the title: controls that stay in view while
   * the body scrolls (the followers dialog's tabs).
   */
  headerContent?: ReactNode;
  /**
   * Makes the panel a `<form>` with this submit handler, so the body's fields
   * and a `type="submit"` button in `footer` are one form: Enter in a field
   * submits it.
   */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  /** The close button's accessible name. */
  closeLabel?: string;
  /** Whether a click on the backdrop closes it, as Escape and the close button do. */
  closeOnBackdrop?: boolean;
  /**
   * Its form is saving: Escape, the backdrop and the close button do nothing,
   * and focus is held on the panel while the control that had it is disabled.
   */
  isSubmitting?: boolean;
  /**
   * Holds focus on the panel while the control that had it is disabled, as
   * `isSubmitting` does, but leaves every way out working: for work the
   * dialog can drop at once (a crop in flight).
   */
  busy?: boolean;
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

/**
 * The app's dialog: a panel over a blurred backdrop, portalled to <body>, with
 * a pinned header (the title and a 32px close button), a body that scrolls,
 * and an optional pinned footer. Escape, the close button and (unless
 * `closeOnBackdrop` is off) a backdrop click close it, through
 * `shouldInterceptClose` / `onInterceptClose` when it has unsaved changes.
 * Focus is managed by `useFocusTrap`: it starts on the close button unless
 * the content has an `autoFocus`.
 */
export default function BaseModal({
  isOpen,
  onClose,
  title,
  titleId,
  children,
  size = 'lg',
  footer,
  headerContent,
  onSubmit,
  closeLabel = 'Close modal',
  closeOnBackdrop = true,
  isSubmitting = false,
  busy = false,
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
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(isOpen, dialogRef, closeButtonRef, { busy: isSubmitting || busy });

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the modal content
    if (e.target === e.currentTarget && closeOnBackdrop && !isSubmitting) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  const panelProps = {
    tabIndex: -1,
    className: `animate-dialog-in flex max-h-full w-full ${sizeStyles[size]} flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg`,
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    role: 'dialog',
    'aria-modal': true,
    'aria-labelledby': titleId,
  } as const;

  const content = (
    <>
      {/* Pinned header */}
      <div className="flex-shrink-0 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex items-center justify-between gap-4">
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
            <h2 id={titleId} className="text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h2>
          </div>
          <IconButton
            ref={closeButtonRef}
            icon="close"
            label={closeLabel}
            onClick={handleClose}
            disabled={isSubmitting}
            className="-mr-1"
          />
        </div>
        {headerContent && <div className="mt-3">{headerContent}</div>}
      </div>
      {/* Scrollable body */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
        {children}
      </div>
      {/* Pinned footer */}
      {footer && (
        <div className="flex flex-shrink-0 justify-end gap-3 border-t border-border px-5 py-4 sm:px-6">
          {footer}
        </div>
      )}
    </>
  );

  return createPortal(
    // Height is pinned to the dynamic viewport (dvh) so the box always fits the
    // *visible* area on mobile — where a `vh`/`inset-0`-sized box overflows behind
    // the browser chrome. The dialog fills almost all of that with small margins,
    // its header and footer stay put, and the body scrolls internally.
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
      {onSubmit ? (
        <form
          ref={dialogRef as React.RefObject<HTMLFormElement | null>}
          onSubmit={onSubmit}
          {...panelProps}
        >
          {content}
        </form>
      ) : (
        <div ref={dialogRef as React.RefObject<HTMLDivElement | null>} {...panelProps}>
          {content}
        </div>
      )}
    </div>,
    document.body
  );
}
