'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import { pickerTriggerClassName } from './fieldStyles';
import { POPOVER_OPTION_ROW, POPOVER_SURFACE } from './popoverStyles';

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
  /** Trigger height. the control scale's `sm` (h-9) for toolbars, `lg` (h-11) to sit beside inputs. */
  size?: 'sm' | 'lg';
  /** Shown, muted, on the trigger while `value` matches no option (nothing picked yet). */
  placeholder?: string;
  /**
   * What the trigger says in place of the selected option's label: a shorter
   * one for a toolbar that has to fit a phone. The options keep their labels.
   */
  valueLabel?: string;
}

/** How long a pause ends a type-ahead search, as in a native select. */
const TYPEAHEAD_RESET_MS = 500;

/**
 * The option a type-ahead search for `text` lands on, searching from `from`
 * (the active option, or -1) and wrapping around; -1 if none matches. One
 * letter moves on to the next option starting with it, so typing it again and
 * again cycles through them. A longer run is matched whole first ("11" on a
 * day picker); a run of one letter that matches nothing whole goes on cycling.
 */
function typeaheadMatch(options: SelectOption[], text: string, from: number): number {
  const find = (prefix: string, start: number) => {
    for (let k = 0; k < options.length; k++) {
      const i = (start + k) % options.length;
      if (options[i].label.toLowerCase().startsWith(prefix)) return i;
    }
    return -1;
  };
  if (text.length > 1) {
    const whole = find(text, Math.max(from, 0));
    if (whole !== -1 || [...text].some((c) => c !== text[0])) return whole;
  }
  return find(text[0], from + 1);
}

/**
 * A custom, fully styled dropdown that replaces the native <select> so both the
 * trigger and the option list look identical across browsers/OSes. The menu is
 * rendered in a portal (fixed-positioned to the trigger) so it never gets
 * clipped by an ancestor's overflow:hidden.
 *
 * From the keyboard it's a WAI-ARIA select-only combobox. The trigger is its
 * one Tab stop and keeps focus while the menu is open, and the options are no
 * Tab stops at all, so it works the same on a page and in a dialog, whose
 * focus trap only ever sees the trigger. Enter, Space or an arrow key opens
 * the menu on the selected option (Home and End at either end, a typed letter
 * at the first match). The arrow keys, Home, End and type-ahead then move the
 * active option (`aria-activedescendant`), Enter or Space picks it, and
 * Escape, Tab or focus leaving the trigger closes the menu without changing
 * the value. The open menu's keys stop at the trigger, so its Escape doesn't
 * also close a dialog around it.
 *
 * The active option is the highlighted one, and the pointer moves it too. A
 * menu opened with a click has none until the pointer or a key picks one, so
 * it looks as it always has, and Enter or Space there only shows where the
 * keyboard is (on the selected option) rather than pick an option unseen.
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
  placeholder,
  valueLabel,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The highlighted option while the menu is open; -1 for none.
  const [active, setActive] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Set when the keyboard moves the active option, so it's scrolled into
  // view; the pointer never scrolls the list under it.
  const scrollToActive = useRef(false);
  const typeahead = useRef<{ text: string; timer?: ReturnType<typeof setTimeout> }>({ text: '' });

  const id = useId();
  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;

  // The menu only renders once the trigger has been measured.
  const menuShown = open && !!rect;
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = options[selectedIndex];
  // Where the keyboard starts: the selected option, else the first.
  const home = Math.max(selectedIndex, 0);

  // A disabled trigger can't take keys, and can lose focus without a blur.
  if (disabled && open) setOpen(false);

  const openMenu = (at: number) => {
    setOpen(true);
    setActive(at);
    scrollToActive.current = at !== -1;
  };

  const moveTo = (at: number) => {
    setActive(at);
    scrollToActive.current = true;
  };

  const choose = (i: number) => {
    const option = options[i];
    if (option) onChange(option.value);
    setOpen(false);
    // Focus is on the trigger already after a keyboard pick; after a click it
    // may not be (Safari doesn't focus a clicked button).
    triggerRef.current?.focus();
  };

  // Measured before the menu paints, so a reopened one never shows for a
  // frame where the trigger was the last time.
  useLayoutEffect(() => {
    if (open && triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    // Keep the menu glued to the trigger on scroll/resize instead of closing.
    // Scrolling the page moves the trigger → we follow it; scrolling the menu's
    // own list (or the trigger staying put) just recomputes the same position.
    const reposition = () => {
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
    };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  // Scroll the menu's own list (never the page) to the option the keyboard
  // moved to, before it paints.
  useLayoutEffect(() => {
    const list = menuRef.current;
    if (!menuShown || !list || !scrollToActive.current) return;
    scrollToActive.current = false;
    const el = list.children[active];
    if (!(el instanceof HTMLElement)) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight;
    }
  }, [menuShown, active]);

  useEffect(() => () => clearTimeout(typeahead.current.timer), []);

  /** Adds `key` to the type-ahead search; returns the option it lands on. */
  const search = (key: string, from: number) => {
    const t = typeahead.current;
    clearTimeout(t.timer);
    t.text += key.toLowerCase();
    t.timer = setTimeout(() => {
      t.text = '';
    }, TYPEAHEAD_RESET_MS);
    return typeaheadMatch(options, t.text, from);
  };

  const endSearch = () => {
    clearTimeout(typeahead.current.timer);
    typeahead.current.text = '';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const last = options.length - 1;
    // A space mid-search is part of it ("US Dollar"), not a pick.
    const typing =
      e.key.length === 1 && (e.key !== ' ' || typeahead.current.text !== '') && options.length > 0;
    if (!typing) endSearch();

    if (e.key === 'Tab') {
      // Focus moves on as usual (a dialog's trap handles it like any Tab).
      if (open) setOpen(false);
      return;
    }

    let handled = true;
    if (typing) {
      const match = search(e.key, open && active !== -1 ? active : selectedIndex);
      if (!open) openMenu(match === -1 ? home : match);
      else if (match !== -1) moveTo(match);
    } else if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) openMenu(home);
      else if (e.key === 'Home') openMenu(0);
      else if (e.key === 'End') openMenu(last);
      else handled = false;
    } else if (e.key === 'Escape') setOpen(false);
    else if (active === -1 && e.key !== 'Home' && e.key !== 'End') {
      // Opened with a click, nothing highlighted yet: the first key shows
      // where the keyboard starts.
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) moveTo(home);
      else handled = false;
    } else if (e.key === 'Enter' || e.key === ' ') choose(active);
    else if (e.key === 'ArrowDown') moveTo(Math.min(active + 1, last));
    else if (e.key === 'ArrowUp') moveTo(Math.max(active - 1, 0));
    else if (e.key === 'Home') moveTo(0);
    else if (e.key === 'End') moveTo(last);
    else handled = false;

    if (!handled) return;
    // Not the button's own click (Enter, Space), a page scroll (Space, the
    // arrows) or anything else the key would do.
    e.preventDefault();
    if (open) {
      // The menu's key, not the page's: the dialogs close on Escape from a
      // keydown listener on `document`. In a portalled modal React handles
      // the key on <body>, so stopping propagation keeps it from them. Outside
      // a portal (a dialog rendered in place, like the followers one) it
      // handles it on `document` itself, Next's React root, so only stopping
      // the listeners added there after React's does.
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={menuShown}
        aria-controls={menuShown ? listboxId : undefined}
        aria-activedescendant={menuShown && options[active] ? optionId(active) : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          // Safari doesn't focus a clicked button, and the menu's keys work
          // through the trigger's focus.
          triggerRef.current?.focus();
          if (open) setOpen(false);
          else openMenu(-1);
        }}
        onKeyDown={onKeyDown}
        // Space clicks a button on keyup; its keydown already did the job
        // (unless a modifier made onKeyDown leave it to the button).
        onKeyUp={(e) => {
          if (e.key === ' ' && !e.altKey && !e.ctrlKey && !e.metaKey) e.preventDefault();
        }}
        onBlur={() => setOpen(false)}
        className={`${pickerTriggerClassName(size)} ${triggerClassName}`}
      >
        {selected ? (
          <span className="truncate">{valueLabel ?? selected.label}</span>
        ) : (
          <span className="truncate text-muted-foreground">{placeholder ?? ''}</span>
        )}
        <Icon
          name="chevron-down"
          size={16}
          className={`flex-shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {menuShown &&
        createPortal(
          <div
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            // Keep focus on the trigger: a click in the menu would otherwise
            // move it to <body>, and the blur would close the menu before the
            // click lands.
            onMouseDown={(e) => e.preventDefault()}
            className={`animate-fade-in fixed z-[70] max-h-72 overflow-auto ${POPOVER_SURFACE}`}
            style={{
              top: rect.bottom + 6,
              left: menuAlign === 'right' ? undefined : rect.left,
              right: menuAlign === 'right' ? window.innerWidth - rect.right : undefined,
              minWidth: rect.width,
            }}
          >
            {options.map((o, i) => {
              const isSel = o.value === value;
              return (
                <div
                  key={o.value}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSel}
                  onClick={() => choose(i)}
                  // Not on mouseenter, which also fires when the keyboard
                  // scrolls the list under a still pointer.
                  onMouseMove={() => {
                    if (i !== active) setActive(i);
                  }}
                  className={`${POPOVER_OPTION_ROW} cursor-pointer justify-between whitespace-nowrap transition-colors ${
                    i === active ? 'bg-row-active' : ''
                  } ${isSel ? 'text-accent' : 'text-foreground'}`}
                >
                  {o.label}
                  {isSel && <Icon name="check" size={16} className="flex-shrink-0" />}
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
}
