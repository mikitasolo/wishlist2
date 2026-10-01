'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Icon, { IconName } from '@/components/Icon';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  /**
   * Return a promise to keep the dialog pending until it settles: both buttons
   * are disabled, Escape and backdrop clicks are ignored, the confirm button
   * shows `pendingText`, and a second click doesn't call this again. The caller
   * still closes the dialog, and reports its own failures.
   */
  onConfirm: () => void | Promise<unknown>;
  onCancel: () => void;
  confirmText?: string;
  /** Confirm button label while `onConfirm`'s promise runs, e.g. "Deleting...". */
  pendingText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  pendingText = 'Please wait...',
  cancelText = 'Cancel',
  type = 'warning',
}: ConfirmDialogProps) {
  // The ref blocks a second click synchronously, before the disabled state renders.
  const [isPending, setIsPending] = useState(false);
  const pendingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Name and describe the dialog by its title and message, so a screen reader
  // reads them out when focus moves in. Per instance, so stacked or repeated
  // dialogs never share an id.
  const titleId = useId();
  const messageId = useId();

  const handleConfirm = async () => {
    if (pendingRef.current) return;
    const result = onConfirm();
    if (!(result instanceof Promise)) return;
    pendingRef.current = true;
    // Disabling the focused button would drop focus to <body>, behind the
    // backdrop: hold it on the dialog itself until the action settles.
    dialogRef.current?.focus();
    setIsPending(true);
    try {
      await result;
    } finally {
      pendingRef.current = false;
      setIsPending(false);
    }
  };

  // Handle Escape key press — capture phase + stopImmediatePropagation
  // so parent modals (BaseModal) don't also process the Escape, even while
  // the action runs and the dialog itself ignores it
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        if (!pendingRef.current) onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => document.removeEventListener('keydown', handleEscape, { capture: true });
  }, [isOpen, onCancel]);

  // Prevent body scroll while the dialog is open (shared, ref-counted lock)
  useBodyScrollLock(isOpen);

  // Focus starts on Cancel, the choice that loses nothing if Enter is pressed
  // straight away, stays inside while it's open, and goes back on close.
  useFocusTrap(isOpen, dialogRef, cancelRef);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the dialog content
    if (e.target === e.currentTarget && !pendingRef.current) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const accent: Record<
    NonNullable<ConfirmDialogProps['type']>,
    { icon: IconName; chip: string; button: string }
  > = {
    danger: {
      icon: 'trash',
      chip: 'bg-red-500/15 text-red-600 dark:text-red-400',
      button: 'bg-red-600 hover:bg-red-700 active:bg-red-800',
    },
    warning: {
      icon: 'alert',
      chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      button: 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800',
    },
    info: {
      icon: 'info',
      chip: 'bg-primary-500/15 text-accent dark:text-primary-400',
      button: 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800',
    },
  };
  const { icon, chip, button } = accent[type];

  return (
    <div
      className="animate-fade-in fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="animate-dialog-in w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <div className="flex gap-4">
          <span
            className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${chip}`}
          >
            <Icon name={icon} size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-semibold tracking-tight text-foreground">
              {title}
            </h2>
            <p id={messageId} className="mt-1.5 text-sm text-muted-foreground">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col justify-end gap-2 sm:flex-row sm:gap-3">
          <button
            ref={cancelRef}
            onClick={onCancel}
            disabled={isPending}
            className="order-2 h-10 rounded-xl bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 sm:order-1"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isPending}
            className={`order-1 h-10 rounded-xl px-4 text-sm font-medium text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:order-2 ${button}`}
          >
            {isPending ? pendingText : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
