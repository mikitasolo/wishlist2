'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

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
 * clipped by an ancestor's overflow:hidden.
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

  useEffect(() => {
    if (!open) return;
    if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());

    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Close on scroll/resize rather than tracking, to avoid a stale position.
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

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
                    setOpen(false);
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
