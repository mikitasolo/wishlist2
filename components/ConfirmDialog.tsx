'use client';

import { useEffect } from 'react';
import Icon, { IconName } from '@/components/Icon';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
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
  cancelText = 'Cancel',
  type = 'warning',
}: ConfirmDialogProps) {
  // Handle Escape key press — capture phase + stopImmediatePropagation
  // so parent modals (BaseModal) don't also process the Escape
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEscape, { capture: true });
    return () => document.removeEventListener('keydown', handleEscape, { capture: true });
  }, [isOpen, onCancel]);

  // Prevent body scroll while the dialog is open (shared, ref-counted lock)
  useBodyScrollLock(isOpen);

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not the dialog content
    if (e.target === e.currentTarget) {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const accent: Record<NonNullable<ConfirmDialogProps['type']>, { icon: IconName; chip: string; button: string }> = {
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
        className="animate-dialog-in w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-lg sm:p-6"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <div className="flex gap-4">
          <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${chip}`}>
            <Icon name={icon} size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col justify-end gap-2 sm:flex-row sm:gap-3">
          <button
            onClick={onCancel}
            className="order-2 h-10 rounded-xl bg-muted px-4 text-sm font-medium text-foreground transition-colors hover:bg-surface-2 sm:order-1"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`order-1 h-10 rounded-xl px-4 text-sm font-medium text-white shadow-sm transition-colors sm:order-2 ${button}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
