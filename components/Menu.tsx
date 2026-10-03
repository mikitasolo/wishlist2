'use client';

import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import Icon, { type IconName } from './Icon';

export interface MenuItem {
  /** The item's visible text, which is also its accessible name. */
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /**
   * Shown dimmed and does nothing when picked, e.g. while the action's
   * request runs. It stays in the menu's arrow-key order (`aria-disabled`).
   */
  disabled?: boolean;
  /** Draws a divider above the item, setting it apart from the ones before it. */
  separated?: boolean;
}

interface MenuProps {
  /** The trigger's accessible name, also shown as its tooltip. */
  label: string;
  items: MenuItem[];
  /** Classes for the trigger: its size and look. */
  triggerClassName?: string;
  /** The trigger's icon (it has no visible text). */
  icon?: IconName;
}

/** px between the trigger and the menu. */
const GAP = 8;
/** px the menu keeps clear of the viewport's edges when it picks a side. */
const MARGIN = 8;

/** Focus has nowhere to be: it dropped to <body> with whatever held it. */
const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

/**
 * A menu button (WAI-ARIA menu button pattern): an icon trigger that opens a
 * list of actions. The menu is rendered in place, positioned against the
 * trigger, so it scrolls with the page and focus can move into it (a popup
 * portalled out of a dialog has to keep focus on its control instead: see
 * `Select`). It opens below the trigger, or above when there's more room
 * there, and right-aligned with it unless that would run off the left edge.
 * It sits over the sticky header rather than under it.
 *
 * From the keyboard: Enter, Space or ArrowDown on the trigger opens it on the
 * first item, ArrowUp on the last. In the menu the arrow keys (wrapping), Home
 * and End move between items, a letter moves to the next item starting with
 * it, and Enter or Space picks one. Escape closes it, as does Tab, with focus
 * back on the trigger (and Tab then moving on from there). A click outside, or
 * focus leaving it, closes it too. Opened with a pointer, the menu itself takes
 * focus, so nothing looks picked until the pointer or a key moves onto an item.
 *
 * Picking an item closes the menu and puts focus back on the trigger before the
 * item's action runs, so a dialog the action opens records the trigger as its
 * opener and gives focus back to it when it closes. If the items change under
 * the focused one (a poll re-rendering the card), focus moves to the menu, and
 * if the menu closes with focus dropped to <body>, to the trigger. The menu's
 * keys stop at the menu, so its Escape doesn't also close a dialog around it.
 */
export default function Menu({ label, items, triggerClassName = '', icon = 'more' }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ above: false, alignLeft: false });
  // What takes focus once the menu is shown: set by whatever opened it.
  const focusOnOpen = useRef<'first' | 'last' | 'menu'>('first');
  // Whether a Space keydown landed on the trigger, which opens on its keyup.
  const spaceDown = useRef(false);
  const wasOpen = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const id = useId();
  const triggerId = `${id}-trigger`;
  const menuId = `${id}-menu`;

  // An empty menu has nothing to offer.
  const empty = items.length === 0;
  if (empty && open) setOpen(false);

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  const openMenu = (focus: 'first' | 'last' | 'menu') => {
    if (empty) return;
    focusOnOpen.current = focus;
    setOpen(true);
  };

  const closeToTrigger = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (item: MenuItem) => {
    if (item.disabled) return;
    closeToTrigger();
    item.onSelect();
  };

  // Pick a side and move focus in before the menu paints.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!open || !trigger || !menu) return;
    const t = trigger.getBoundingClientRect();
    const roomBelow = window.innerHeight - t.bottom - GAP - MARGIN;
    const roomAbove = t.top - GAP - MARGIN;
    setPlacement({
      above: menu.offsetHeight > roomBelow && roomAbove > roomBelow,
      alignLeft: t.right - menu.offsetWidth < MARGIN,
    });
    const all = menuItems();
    const target =
      focusOnOpen.current === 'menu'
        ? menu
        : focusOnOpen.current === 'last'
          ? all[all.length - 1]
          : all[0];
    // Not scrolled to: the menu may still be on its old side until it's placed.
    target?.focus({ preventScroll: true });
  }, [open]);

  // Focus never strands: not on an item that's gone while the menu is open
  // (its keys would then reach nothing), nor on <body> once it has closed.
  useLayoutEffect(() => {
    if (open && focusIsLost()) menuRef.current?.focus({ preventScroll: true });
    else if (!open && wasOpen.current && focusIsLost()) {
      triggerRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = open;
  });

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: globalThis.MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, [open]);

  const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    spaceDown.current = false;
    if (e.altKey || e.ctrlKey || e.metaKey || empty) return;
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    // Not the button's own click (Enter) or a page scroll (Space, arrows).
    e.preventDefault();
    if (e.key === ' ') {
      // Opened on the keyup instead: opened now, focus would be on the first
      // item by then, and Firefox would take that keyup as a click on it.
      spaceDown.current = !open;
      return;
    }
    if (open) closeToTrigger();
    else openMenu(e.key === 'ArrowUp' ? 'last' : 'first');
  };

  const onTriggerKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' || e.altKey || e.ctrlKey || e.metaKey) return;
    // Space clicks a button on keyup; its keydown decided what happens.
    e.preventDefault();
    if (spaceDown.current) openMenu('first');
    spaceDown.current = false;
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const all = menuItems();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => all[i]?.focus();

    if (e.key === 'Tab') {
      // Focus goes back to the trigger, and the Tab moves on from there.
      closeToTrigger();
      return;
    }

    let handled = true;
    if (e.key === 'ArrowDown') focus((at + 1) % all.length);
    else if (e.key === 'ArrowUp') focus(at <= 0 ? all.length - 1 : at - 1);
    else if (e.key === 'Home') focus(0);
    else if (e.key === 'End') focus(all.length - 1);
    else if (e.key === 'Escape') closeToTrigger();
    else if (e.key.length === 1 && e.key !== ' ') {
      const key = e.key.toLowerCase();
      for (let k = 1; k <= all.length; k++) {
        const i = (at + k + all.length) % all.length;
        if (all[i].textContent?.trim().toLowerCase().startsWith(key)) {
          focus(i);
          break;
        }
      }
    } else handled = false;

    if (!handled) return;
    e.preventDefault();
    // The menu's key, not the page's: dialogs close on Escape from a keydown
    // listener on `document` (see `Select`).
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
  };

  return (
    <div
      ref={wrapperRef}
      className="relative flex"
      onBlur={(e) => {
        if (open && !wrapperRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={empty || undefined}
        // While it's open, keep focus in the menu: Safari and Firefox on macOS
        // don't focus a clicked button, so the mousedown would blur the menu,
        // and the blur close it, before the click (to close it) reopened it.
        onMouseDown={(e) => {
          if (open) e.preventDefault();
        }}
        onClick={(e: MouseEvent<HTMLButtonElement>) => {
          if (open) closeToTrigger();
          // The menu's keys need focus inside it, which Safari doesn't give a
          // clicked button. A click with no pointer behind it (`detail` 0:
          // assistive tech) opens on the first item, as a key would.
          else openMenu(e.detail === 0 ? 'first' : 'menu');
        }}
        onKeyDown={onTriggerKeyDown}
        onKeyUp={onTriggerKeyUp}
        className={triggerClassName}
      >
        <Icon name={icon} size={18} />
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          // Keep focus where it is: a click would otherwise move it to <body>
          // in Safari, and the blur would close the menu before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          onMouseLeave={() => {
            if (menuRef.current?.contains(document.activeElement)) {
              menuRef.current.focus({ preventScroll: true });
            }
          }}
          className={`animate-fade-in absolute z-50 w-max min-w-[12rem] max-w-[calc(100vw-1rem)] rounded-xl border border-border bg-surface p-1.5 shadow-lg outline-none ${
            placement.above ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${placement.alignLeft ? 'left-0' : 'right-0'}`}
        >
          {items.map((item, i) => (
            <Fragment key={item.label}>
              {item.separated && i > 0 && (
                <div role="separator" className="-mx-1.5 my-1.5 border-t border-border" />
              )}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={item.disabled || undefined}
                onClick={() => choose(item)}
                // The pointer moves the highlight, which is focus, so the
                // keyboard carries on from wherever it is.
                onMouseMove={(e) => {
                  if (document.activeElement !== e.currentTarget) {
                    e.currentTarget.focus({ preventScroll: true });
                  }
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2.5 text-left text-sm font-medium text-foreground outline-hidden transition-colors focus:bg-muted aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              >
                {item.icon && (
                  <Icon
                    name={item.icon}
                    size={17}
                    className="flex-shrink-0 text-muted-foreground"
                  />
                )}
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
