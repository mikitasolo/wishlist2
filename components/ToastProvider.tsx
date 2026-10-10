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
}

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
  /** How many identical toasts this one stands for (shown as "×2"). */
  count: number;
  /** Bumped when an identical toast merges in, which restarts the timer. */
  stamp: number;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void;
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

  const removeToast = useCallback((id: string) => {
    // The element that held hover or focus may be the one going away, with no
    // mouseleave / blur to follow, so a removal always un-pauses the stack.
    setHovered(false);
    setFocused(false);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', options: ToastOptions = {}) => {
      const { action } = options;
      setToasts((prev) => {
        const twin = prev.find(
          (t) => t.message === message && t.type === type && sameAction(t.action, action)
        );
        if (twin) {
          // An identical toast merges: it moves to the front, counted, timer restarted.
          return [
            ...prev.filter((t) => t !== twin),
            { ...twin, action, count: twin.count + 1, stamp: twin.stamp + 1 },
          ];
        }
        const next = [
          ...prev,
          { id: `toast-${counter++}`, message, type, action, count: 1, stamp: 0 },
        ];
        return next.slice(-MAX_TOASTS);
      });
    },
    []
  );

  // An empty stack can't be hovered or focused any more.
  useEffect(() => {
    if (toasts.length === 0) {
      setHovered(false);
      setFocused(false);
    }
  }, [toasts.length]);

  return (
    <ToastContext.Provider value={{ showToast }}>
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
}: {
  toast: Toast;
  depth: number;
  paused: boolean;
  onRemove: (id: string) => void;
}) {
  const { icon, tone } = config[toast.type];
  const { id, action, stamp } = toast;
  const duration = action ? TOAST_WITH_ACTION_MS : TOAST_MS;

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
