'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import Link from 'next/link';
import Icon, { IconName } from '@/components/Icon';
import Button from '@/components/Button';
import IconButton from '@/components/IconButton';
import { buttonClassName } from '@/components/buttonStyles';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

type ToastType = 'success' | 'error' | 'info';

/**
 * An optional action inside a toast: a button that runs `onClick`, or a link to
 * `href`. Either way the toast is dismissed when it's used.
 */
export type ToastAction = { label: string; onClick: () => void } | { label: string; href: string };

interface ToastOptions {
  action?: ToastAction;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
}

const TOAST_MS = 4000;
/** A toast with an action stays up longer, so there's time to reach it. */
const TOAST_WITH_ACTION_MS = 8000;

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const config: Record<ToastType, { icon: IconName; chip: string }> = {
  success: {
    icon: 'check-circle',
    chip: TONE_CLASSES.success.tint,
  },
  error: { icon: 'alert', chip: TONE_CLASSES.danger.tint },
  info: { icon: 'info', chip: TONE_CLASSES.info.tint },
};

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', options: ToastOptions = {}) => {
      const id = `toast-${counter++}`;
      const { action } = options;
      setToasts((prev) => [...prev, { id, message, type, action }]);
      setTimeout(() => removeToast(id), action ? TOAST_WITH_ACTION_MS : TOAST_MS);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
        {toasts.map((toast) => {
          const { icon, chip } = config[toast.type];
          return (
            <div
              key={toast.id}
              role="status"
              className="animate-toast-in pointer-events-auto flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-lg"
              onClick={() => removeToast(toast.id)}
            >
              <span
                className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${chip}`}
              >
                <Icon name={icon} size={18} />
              </span>
              <p className="flex-1 text-sm font-medium text-foreground">{toast.message}</p>
              {toast.action &&
                ('href' in toast.action ? (
                  <Link
                    href={toast.action.href}
                    className={buttonClassName({ variant: 'soft', size: 'sm' })}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeToast(toast.id);
                    }}
                  >
                    {toast.action.label}
                  </Link>
                ) : (
                  <Button
                    variant="soft"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      const { onClick } = toast.action as { onClick: () => void };
                      removeToast(toast.id);
                      onClick();
                    }}
                  >
                    {toast.action.label}
                  </Button>
                ))}
              {/* 32px to hit, drawn into the toast's padding so it's no taller. */}
              <IconButton
                icon="close"
                label="Dismiss notification"
                onClick={(e) => {
                  e.stopPropagation();
                  removeToast(toast.id);
                }}
                className="-my-1 -mr-2"
              />
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
