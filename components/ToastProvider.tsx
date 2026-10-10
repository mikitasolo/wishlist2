'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  CSSProperties,
  ReactNode,
} from 'react';
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
  /** How long it stays up (ms), instead of the default for its kind. */
  duration?: number;
  /**
   * Called once when the toast goes for any reason but its action being used:
   * its timer, its close button, a swipe, a tap, `dismissToast`, or being
   * dropped from a full stack. An Undo toast commits on it (`useUndoableAction`).
   */
  onDismiss?: () => void;
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  duration?: number;
  /** How many identical toasts this one stands for (shown as "×2"). */
  count: number;
  /** Bumped when an identical toast merges in, which restarts the timer. */
  stamp: number;
}

interface ToastContextType {
  /** Shows a toast and returns its id (for `dismissToast`). */
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => string;
  /** Takes a toast down, if it's still up. */
  dismissToast: (id: string) => void;
}

export const TOAST_MS = 4000;
/** A toast with an action stays up longer, so there's time to reach it. */
export const TOAST_WITH_ACTION_MS = 8000;
/** At most this many toasts are on screen; the oldest is dropped for a new one. */
export const MAX_TOASTS = 3;
/** Dragged this far sideways (px), a toast is dismissed on release. */
const SWIPE_DISMISS_PX = 80;

const ToastContext = createContext<ToastContextType | undefined>(undefined);

// The tone shows in the icon only; the card itself stays neutral.
const config: Record<ToastType, { icon: IconName; tone: string }> = {
  success: { icon: 'check-circle', tone: TONE_CLASSES.success.text },
  error: { icon: 'alert', tone: TONE_CLASSES.danger.text },
  info: { icon: 'info', tone: TONE_CLASSES.info.text },
};

let counter = 0;

/** Two toasts merge only when they'd do the same thing: same label and target (a button's callback by identity). */
function sameAction(a?: ToastAction, b?: ToastAction) {
  if (!a || !b) return !a && !b;
  if (a.label !== b.label) return false;
  if ('href' in a || 'href' in b) return 'href' in a && 'href' in b && a.href === b.href;
  return a.onClick === (b as { onClick: () => void }).onClick;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Hover or keyboard focus anywhere in the stack fans it out and holds every timer.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;

  // Each toast's `onDismiss`, by id, until the toast goes (see the effect below),
  // and the toasts that went by their action, which don't call it.
  const dismissHandlers = useRef(new Map<string, () => void>());
  const actioned = useRef(new Set<string>());

  const removeToast = useCallback((id: string) => {
    // The element that held hover or focus may be the one going away, with no
    // mouseleave / blur to follow, so a removal always un-pauses the stack.
    setHovered(false);
    setFocused(false);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', options: ToastOptions = {}) => {
      const { action, duration, onDismiss } = options;
      // A toast with its own dismiss handler is its own: it never merges. The
      // id returned is a merged toast's only while it's unmerged, so only one
      // with `onDismiss` can be relied on to be taken down by it.
      const id = `toast-${counter++}`;
      setToasts((prev) => {
        const twin = onDismiss
          ? undefined
          : prev.find(
              (t) =>
                !dismissHandlers.current.has(t.id) &&
                t.message === message &&
                t.type === type &&
                t.duration === duration &&
                sameAction(t.action, action)
            );
        if (twin) {
          // An identical toast merges: it moves to the front, counted, timer restarted.
          return [
            ...prev.filter((t) => t !== twin),
            { ...twin, action, count: twin.count + 1, stamp: twin.stamp + 1 },
          ];
        }
        // Registered with the toast itself, so the effect below can't see the
        // handler before the toast it belongs to.
        if (onDismiss) dismissHandlers.current.set(id, onDismiss);
        const next = [...prev, { id, message, type, action, duration, count: 1, stamp: 0 }];
        return next.slice(-MAX_TOASTS);
      });
      return id;
    },
    []
  );

  const dismissToast = useCallback((id: string) => removeToast(id), [removeToast]);

  // Marks a toast as gone by its action, so its `onDismiss` isn't called.
  const actionUsed = useCallback((id: string) => {
    actioned.current.add(id);
  }, []);

  // A toast that has gone, however it went (removed, or dropped from a full
  // stack), answers its `onDismiss` once, unless its action was used.
  useEffect(() => {
    const shown = new Set(toasts.map((t) => t.id));
    for (const [id, onDismiss] of [...dismissHandlers.current]) {
      if (shown.has(id)) continue;
      dismissHandlers.current.delete(id);
      if (actioned.current.delete(id)) continue;
      onDismiss();
    }
    for (const id of [...actioned.current]) if (!shown.has(id)) actioned.current.delete(id);
  }, [toasts]);

  // An empty stack can't be hovered or focused any more.
  useEffect(() => {
    if (toasts.length === 0) {
      setHovered(false);
      setFocused(false);
    }
  }, [toasts.length]);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}

      <div
        className="toast-region"
        data-expanded={paused ? 'true' : 'false'}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
        }}
      >
        {toasts.map((toast, i) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            depth={toasts.length - 1 - i}
            paused={paused}
            onRemove={removeToast}
            onAction={actionUsed}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  depth,
  paused,
  onRemove,
  onAction,
}: {
  toast: Toast;
  depth: number;
  paused: boolean;
  onRemove: (id: string) => void;
  onAction: (id: string) => void;
}) {
  const { icon, tone } = config[toast.type];
  const { id, action, stamp } = toast;
  const duration = toast.duration ?? (action ? TOAST_WITH_ACTION_MS : TOAST_MS);

  // The time left on this toast: a pause keeps it, a merge resets it.
  const remaining = useRef(duration);
  const startedAt = useRef(0);
  const lastStamp = useRef(stamp);
  useEffect(() => {
    if (paused) return;
    if (lastStamp.current !== stamp) {
      lastStamp.current = stamp;
      remaining.current = duration;
    }
    startedAt.current = Date.now();
    const timer = setTimeout(() => onRemove(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, stamp, duration, id, onRemove]);

  // Swipe sideways to dismiss (touch and pen; a mouse has the button).
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const finishDrag = (dismiss: boolean) => {
    drag.current = null;
    // A click follows a drag's release; it isn't a tap.
    dragged.current = dx !== 0;
    setTimeout(() => (dragged.current = false), 0);
    if (dismiss) onRemove(id);
    else setDx(0);
  };

  return (
    <div
      className="toast-slot"
      data-back={depth > 0 ? 'true' : 'false'}
      style={{ '--toast-depth': depth } as CSSProperties}
    >
      <div
        role="status"
        className="toast-card flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-foreground shadow-lg"
        style={
          dx
            ? { transform: `translateX(${dx}px)`, opacity: 1 - Math.min(Math.abs(dx) / 200, 0.6) }
            : undefined
        }
        onClick={() => {
          if (!dragged.current) onRemove(id);
        }}
        onPointerDown={(e) => {
          if (e.pointerType !== 'mouse') drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const start = drag.current;
          if (!start) return;
          const moved = e.clientX - start.x;
          if (Math.abs(moved) > 6 && Math.abs(moved) > Math.abs(e.clientY - start.y)) {
            if (dx === 0) e.currentTarget.setPointerCapture?.(e.pointerId);
            setDx(moved);
          }
        }}
        onPointerUp={() => finishDrag(Math.abs(dx) >= SWIPE_DISMISS_PX)}
        onPointerCancel={() => finishDrag(false)}
      >
        <span className={`flex flex-shrink-0 items-center justify-center ${tone}`}>
          <Icon name={icon} size={18} />
        </span>
        <p className="flex-1 text-sm font-medium text-foreground">
          {toast.message}
          {toast.count > 1 && (
            <span className="ml-2 rounded-full bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">
              ×{toast.count}
            </span>
          )}
        </p>
        {action &&
          ('href' in action ? (
            <Link
              href={action.href}
              className={buttonClassName({ variant: 'soft', size: 'sm' })}
              onClick={(e) => {
                e.stopPropagation();
                onAction(id);
                onRemove(id);
              }}
            >
              {action.label}
            </Link>
          ) : (
            <Button
              variant="soft"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAction(id);
                onRemove(id);
                action.onClick();
              }}
            >
              {action.label}
            </Button>
          ))}
        {/* 32px to hit, drawn into the toast's padding so it's no taller. */}
        <IconButton
          icon="close"
          label="Dismiss notification"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(id);
          }}
          className="-my-1 -mr-2"
        />
      </div>
    </div>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
