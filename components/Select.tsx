'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { useFocusTrapPortal } from '@/lib/hooks/useFocusTrap';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  ariaLabel?: string;
  /** Extra classes for the trigger button (width, min-width, etc.). */
  triggerClassName?: string;
  menuAlign?: 'left' | 'right';
  /** Trigger height. 'sm' (h-9) for toolbars, 'md' (h-11) to sit beside inputs. */
  size?: 'sm' | 'md';
}

const sizeStyles = {
  sm: 'h-9 text-sm',
  md: 'h-11 text-[15px]',
};

/**
 * A custom, fully styled dropdown that replaces the native <select> so both the
 * trigger and the option list look identical across browsers/OSes. The menu is
 * rendered in a portal (fixed-positioned to the trigger) so it never gets
 * clipped by an ancestor's overflow:hidden. Inside a dialog, the menu is part
 * of its focus trap: Tab goes from the trigger into the options, and past the
 * last one on to the next field, which closes the menu.
 */
export default function Select({
  value,
  onChange,
  options,
  disabled = false,
  ariaLabel,
  triggerClassName = '',
  menuAlign = 'left',
  size = 'sm',
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu only renders once the trigger has been measured.
  const menuShown = open && !!rect;
  useFocusTrapPortal(menuShown, menuRef, triggerRef);

  // Closing the menu removes whatever option had focus; hand it to the trigger
  // rather than let it drop to <body>.
  const close = useCallback(() => {
    if (menuRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());

    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // Keep the menu glued to the trigger on scroll/resize instead of closing.
    // Scrolling the page moves the trigger → we follow it; scrolling the menu's
    // own list (or the trigger staying put) just recomputes the same position.
    const reposition = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open, close]);

  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center justify-between gap-2 rounded-xl border border-border-strong bg-surface px-3.5 font-medium text-foreground outline-none transition-colors hover:bg-surface-hover disabled:opacity-50 ${sizeStyles[size]} ${triggerClassName}`}
      >
        <span className="truncate">{selected?.label ?? ''}</span>
        <Icon
          name="chevron-down"
          size={16}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open &&
        rect &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            // Tabbing on past the last option (or focus going anywhere else but
            // back to the trigger) closes the menu, as a native select's does,
            // rather than leave it open over the fields after it.
            onBlur={(e) => {
              const to = e.relatedTarget;
              if (to && !menuRef.current?.contains(to) && !triggerRef.current?.contains(to)) {
                setOpen(false);
              }
            }}
            className="animate-fade-in fixed z-[70] max-h-72 overflow-auto rounded-xl border border-border bg-surface py-1.5 shadow-lg"
            style={{
              top: rect.bottom + 6,
              left: menuAlign === 'right' ? undefined : rect.left,
              right: menuAlign === 'right' ? window.innerWidth - rect.right : undefined,
              minWidth: rect.width,
            }}
          >
            {options.map((o) => {
              const isSel = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={isSel}
                  onClick={() => {
                    onChange(o.value);
                    close();
                  }}
                  className={`flex w-full items-center justify-between gap-4 whitespace-nowrap px-3.5 py-2 text-left text-sm transition-colors hover:bg-muted ${
                    isSel ? 'font-semibold text-accent' : 'text-foreground'
                  }`}
                >
                  {o.label}
                  {isSel && <Icon name="check" size={15} className="flex-shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
