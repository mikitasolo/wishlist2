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
  type ReactNode,
} from 'react';
import Link from 'next/link';
import Icon, { type IconName } from './Icon';
import {
  POPOVER_ACTION_ROW,
  MENU_ICON_SIZE,
  POPOVER_SEPARATOR,
  POPOVER_SURFACE,
} from './popoverStyles';

export interface MenuItem {
  type?: 'item';
  /** The item's visible text, which is also its accessible name. */
  label: string;
  icon?: IconName;
  /**
   * Runs when it's picked, with focus already back on the trigger. On a link
   * item it runs in the link's click, before the navigation starts.
   */
  onSelect?: () => void;
  /** Makes it a link to this path, followed when it's picked. */
  href?: string;
  /**
   * With `href`: a page on another site (an item's product page), opened in a
   * new tab rather than through the app's router.
   */
  external?: boolean;
  /** Drawn at the end of the row: a decoration, such as a dot (mark it `aria-hidden`). */
  trailing?: ReactNode;
  /**
   * Shown dimmed and does nothing when picked, e.g. while the action's
   * request runs. It stays in the menu's arrow-key order (`aria-disabled`).
   */
  disabled?: boolean;
  /** Draws a divider above the item, setting it apart from the ones before it. */
  separated?: boolean;
  /** Starts a deletion: the label and icon are red (the `danger` token). */
  danger?: boolean;
}

/**
 * A choice of one of a few options (the theme), shown side by side as a
 * segmented control. Each option is a `menuitemradio` in the menu's arrow-key
 * order, and picking one leaves the menu open, so the change can be seen.
 */
export interface MenuRadioGroup {
  type: 'radio-group';
  /** The group's accessible name. */
  label: string;
  value: string;
  options: { value: string; label: string; icon?: IconName }[];
  onChange: (value: string) => void;
  separated?: boolean;
}

export type MenuEntry = MenuItem | MenuRadioGroup;

interface MenuProps {
  /** The trigger's accessible name. Shown as its tooltip when it's an icon. */
  label: string;
  items: MenuEntry[];
  /** Classes for the trigger: its size and look. */
  triggerClassName?: string;
  /** The trigger's icon, when it has no `trigger` content. */
  icon?: IconName;
  /**
   * What the trigger shows instead of the icon (an avatar and a name), given
   * whether the menu is open. It's still named by `label`, with no tooltip.
   */
  trigger?: (open: boolean) => ReactNode;
  /** The menu's accessible name, if not the trigger's. */
  menuLabel?: string;
  /**
   * Shown at the top of the menu, above its items and not one of them (who's
   * signed in). It's outside the `role="menu"` element, so the arrow keys and
   * type-ahead skip it.
   */
  header?: ReactNode;
  /**
   * The `header` describes the menu (`aria-describedby`), so a screen reader
   * reads it when focus moves in: set it when the header says something about
   * the items (who a link opens for), not just who's signed in.
   */
  headerDescribesMenu?: boolean;
  /** Classes for the wrapper around the trigger and the menu. */
  className?: string;
  /** The menu's width. By default it fits its widest item, at least 12rem. */
  menuWidthClassName?: string;
  /** Told whenever the menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Always open above the trigger: for a menu at the bottom of a panel that
   * clips what overflows it (a dialog's footer), where the window's room below
   * isn't room the menu has.
   */
  opensAbove?: boolean;
}

const isRadioGroup = (entry: MenuEntry): entry is MenuRadioGroup => entry.type === 'radio-group';

/** The menu's items, the arrow keys' stops, in order. */
const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"]';

/** px between the trigger and the menu. */
const GAP = 8;
/** px the menu keeps clear of the viewport's edges when it picks a side. */
const MARGIN = 8;

/**
 * Where the screen's free space ends: the top of the phone's tab bar while one
 * is shown (`TabBar`, components/AppNav.tsx), so a menu doesn't open down
 * behind it, and the bottom of the viewport otherwise.
 */
function screenBottom(): number {
  const bar = document.querySelector('[data-tab-bar]')?.getBoundingClientRect();
  return bar && bar.height > 0 ? Math.min(window.innerHeight, bar.top) : window.innerHeight;
}

/** Focus has nowhere to be: it dropped to <body> with whatever held it. */
const focusIsLost = () => !document.activeElement || document.activeElement === document.body;

/**
 * A menu button (WAI-ARIA menu button pattern): a trigger that opens a list of
 * actions. The trigger is an icon, or whatever `trigger` draws (the account
 * menu's avatar and name). The menu may have a `header` above its items, and
 * a radio group (`MenuRadioGroup`) among them. It's rendered in place,
 * positioned against the trigger, so it scrolls with the page and focus can
 * move into it (a popup portalled out of a dialog has to keep focus on its
 * control instead: see `Select`). It opens below the trigger, or above when
 * there's more room there, and right-aligned with it unless that would run off
 * the left edge, then left-aligned, or, if that runs off the right edge too,
 * kept to the viewport's left margin. It sits over the sticky header rather
 * than under it.
 *
 * From the keyboard: Enter, Space or ArrowDown on the trigger opens it on the
 * first item, ArrowUp on the last. In the menu the arrow keys (wrapping), Home
 * and End move between items (a radio group's options included), a letter
 * moves to the next item starting with it, and Enter or Space picks one.
 * Escape closes it, as does Tab, with focus back on the trigger (and Tab then
 * moving on from there). A click outside, or focus leaving it, closes it too.
 * Opened with a pointer, the menu itself takes focus, so nothing looks picked
 * until the pointer or a key moves onto an item.
 *
 * Picking an item closes the menu and puts focus back on the trigger before the
 * item's action runs, so a dialog the action opens records the trigger as its
 * opener and gives focus back to it when it closes. Picking a radio option
 * leaves it open, on that option. If the items change under the focused one
 * (a poll re-rendering the card), focus moves to the menu, and if the menu
 * closes with focus dropped to <body>, to the trigger. The menu's keys stop at
 * the menu, so its Escape doesn't also close a dialog around it.
 */
export default function Menu({
  label,
  items,
  triggerClassName = '',
  icon = 'more',
  trigger,
  menuLabel,
  header,
  headerDescribesMenu = false,
  className = 'relative flex',
  menuWidthClassName = 'w-max min-w-[12rem]',
  onOpenChange,
  opensAbove = false,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  // Which side of the trigger the menu opens on, and how it lines up with it:
  // right-aligned, left-aligned, or, when neither fits, `shiftLeft` px from
  // the wrapper's left edge, pinned to the viewport's margin.
  const [placement, setPlacement] = useState<{
    above: boolean;
    alignLeft: boolean;
    shiftLeft?: number;
  }>({ above: false, alignLeft: false });
  // What takes focus once the menu is shown: set by whatever opened it.
  const focusOnOpen = useRef<'first' | 'last' | 'menu'>('first');
  // Whether a Space keydown landed on the trigger, which opens on its keyup.
  const spaceDown = useRef(false);
  const wasOpen = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const id = useId();
  const triggerId = `${id}-trigger`;
  const menuId = `${id}-menu`;
  const headerId = `${id}-header`;

  // An empty menu has nothing to offer.
  const empty = items.length === 0;
  if (empty && open) setOpen(false);

  // Told after the commit, so a parent's state set in it doesn't update
  // another component while this one renders. Once per change: a new
  // `onOpenChange` on every render doesn't repeat it.
  const toldOpen = useRef(false);
  useEffect(() => {
    if (toldOpen.current === open) return;
    toldOpen.current = open;
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  const menuItems = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);

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
    item.onSelect?.();
  };

  // Pick a side and move focus in before the menu paints.
  useLayoutEffect(() => {
    const triggerEl = triggerRef.current;
    const popover = popoverRef.current;
    const menu = menuRef.current;
    if (!open || !triggerEl || !popover || !menu) return;
    const t = triggerEl.getBoundingClientRect();
    const roomBelow = screenBottom() - t.bottom - GAP - MARGIN;
    const roomAbove = t.top - GAP - MARGIN;
    const width = popover.offsetWidth;
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const fitsRightAligned = t.right - width >= MARGIN;
    const fitsLeftAligned = t.left + width <= viewportWidth - MARGIN;
    setPlacement({
      above: opensAbove || (popover.offsetHeight > roomBelow && roomAbove > roomBelow),
      alignLeft: !fitsRightAligned,
      // A trigger mid-row on a phone (a page header's Share): neither edge of
      // it leaves room, so the menu keeps to the viewport's left margin.
      shiftLeft:
        fitsRightAligned || fitsLeftAligned
          ? undefined
          : MARGIN - (wrapperRef.current?.getBoundingClientRect().left ?? t.left),
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
  }, [open, opensAbove]);

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
    else if (e.key === ' ' && document.activeElement instanceof HTMLAnchorElement) {
      // Space picks an item, a link one too (a link only follows Enter).
      document.activeElement.click();
    } else if (e.key.length === 1 && e.key !== ' ') {
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

  // The pointer moves the highlight, which is focus, so the keyboard carries
  // on from wherever it is.
  const followPointer = (e: MouseEvent<HTMLElement>) => {
    if (document.activeElement !== e.currentTarget) {
      e.currentTarget.focus({ preventScroll: true });
    }
  };

  const itemContent = (item: MenuItem) => (
    <>
      {item.icon && (
        <Icon
          name={item.icon}
          size={MENU_ICON_SIZE}
          className={`flex-shrink-0 ${item.danger ? '' : 'text-muted-foreground'}`}
        />
      )}
      {item.label}
      {item.trailing}
    </>
  );

  const itemClassName = (item: MenuItem) =>
    `${POPOVER_ACTION_ROW} cursor-pointer whitespace-nowrap ${item.danger ? 'text-danger' : 'text-foreground'} outline-hidden transition-colors focus:bg-row-active aria-disabled:cursor-not-allowed aria-disabled:opacity-50`;

  const renderItem = (item: MenuItem) => {
    if (item.href) {
      const linkProps = {
        href: item.href,
        role: 'menuitem',
        tabIndex: -1,
        'aria-disabled': item.disabled || undefined,
        onClick: (e: MouseEvent<HTMLAnchorElement>) => {
          if (item.disabled) e.preventDefault();
          else choose(item);
        },
        onMouseMove: followPointer,
        className: itemClassName(item),
      };
      return item.external ? (
        <a {...linkProps} target="_blank" rel="noopener noreferrer">
          {itemContent(item)}
        </a>
      ) : (
        <Link {...linkProps}>{itemContent(item)}</Link>
      );
    }
    return (
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={item.disabled || undefined}
        onClick={() => choose(item)}
        onMouseMove={followPointer}
        className={itemClassName(item)}
      >
        {itemContent(item)}
      </button>
    );
  };

  const renderRadioGroup = (group: MenuRadioGroup) => {
    const selected = Math.max(
      group.options.findIndex((o) => o.value === group.value),
      0
    );
    const n = group.options.length;
    return (
      <div role="group" aria-label={group.label} className="px-1.5 py-1">
        <div className="relative flex rounded-xl border border-border bg-surface-2 p-1">
          <span
            aria-hidden
            className="absolute bottom-1 top-1 rounded-lg bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)]"
            style={{
              width: `calc((100% - 0.5rem) / ${n})`,
              left: `calc(${selected} * ((100% - 0.5rem) / ${n}) + 0.25rem)`,
            }}
          />
          {group.options.map((option) => {
            const checked = option.value === group.value;
            return (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                onClick={() => group.onChange(option.value)}
                onMouseMove={followPointer}
                className={`relative z-10 flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                  checked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.icon && <Icon name={option.icon} size={16} className="flex-shrink-0" />}
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      ref={wrapperRef}
      className={className}
      onBlur={(e) => {
        if (open && !wrapperRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={label}
        title={trigger ? undefined : label}
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
        {trigger ? trigger(open) : <Icon name={icon} size={18} />}
      </button>

      {open && (
        <div
          ref={popoverRef}
          // Keep focus where it is: a click would otherwise move it to <body>
          // in Safari, and the blur would close the menu before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          onMouseLeave={() => {
            if (menuRef.current?.contains(document.activeElement)) {
              menuRef.current.focus({ preventScroll: true });
            }
          }}
          className={`animate-fade-in absolute z-50 max-w-[calc(100vw-1rem)] ${menuWidthClassName} ${POPOVER_SURFACE} ${
            placement.above ? 'bottom-full mb-2' : 'top-full mt-2'
          } ${placement.shiftLeft !== undefined ? '' : placement.alignLeft ? 'left-0' : 'right-0'}`}
          style={placement.shiftLeft !== undefined ? { left: placement.shiftLeft } : undefined}
        >
          {header && (
            <div id={headerId} className="-mx-1.5 -mt-1.5 mb-1.5 border-b border-border px-4 py-3">
              {header}
            </div>
          )}
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={menuLabel}
            aria-labelledby={menuLabel ? undefined : triggerId}
            aria-describedby={header && headerDescribesMenu ? headerId : undefined}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            className="outline-hidden"
          >
            {items.map((entry, i) => (
              <Fragment key={entry.label}>
                {entry.separated && i > 0 && <div role="separator" className={POPOVER_SEPARATOR} />}
                {isRadioGroup(entry) ? renderRadioGroup(entry) : renderItem(entry)}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
