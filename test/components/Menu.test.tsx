// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import Menu, { type MenuEntry, type MenuItem } from '@/components/Menu';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const picked = vi.fn();

beforeEach(() => {
  cleanup();
  picked.mockReset();
});
afterEach(() => vi.restoreAllMocks());

const actions: MenuItem[] = [
  { label: 'Mark as completed', icon: 'check-circle', onSelect: () => picked('complete') },
  { label: 'Move to draft', icon: 'note', onSelect: () => picked('draft') },
  { label: 'Save to my list', icon: 'plus', onSelect: () => picked('save'), separated: true },
];

/** A menu on a page, between two buttons. */
function Page({ items = actions }: { items?: MenuItem[] }) {
  return (
    <>
      <button>Before</button>
      <Menu label="More actions" items={items} />
      <button>After</button>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: 'More actions' });
const menu = () => screen.queryByRole('menu');
const item = (name: string) => screen.getByRole('menuitem', { name });
const labels = () => screen.getAllByRole('menuitem').map((el) => el.textContent);

describe('Menu — the trigger', () => {
  it('is a menu button named by its label, with a matching tooltip, closed to start', () => {
    render(<Page />);
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveAttribute('title', 'More actions');
    expect(trigger()).not.toHaveAttribute('aria-controls');
    expect(menu()).toBeNull();
  });

  it('opens on a click, naming and pointing at the menu, with the menu itself focused', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());

    expect(menu()).toBeInTheDocument();
    expect(menu()).toHaveAccessibleName('More actions');
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger()).toHaveAttribute('aria-controls', menu()!.id);
    expect(labels()).toEqual(['Mark as completed', 'Move to draft', 'Save to my list']);
    // Nothing looks picked until the pointer or a key moves onto an item.
    expect(menu()).toHaveFocus();
    // The items are no Tab stops: the arrow keys move between them.
    for (const el of screen.getAllByRole('menuitem')) expect(el).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('separator')).toBeInTheDocument();

    await user.keyboard('{ArrowDown}');
    expect(item('Mark as completed')).toHaveFocus();
  });

  it('closes on a second click, with focus on the trigger', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    await user.click(trigger());
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).toHaveFocus();
  });

  // regression guard: Safari and Firefox on macOS don't focus a clicked
  // button, so a mousedown on the trigger blurred the open menu, the blur
  // closed it, and the click then opened it again: it could never be closed
  // from its own button. Its mousedown keeps focus in the open menu instead.
  it('keeps focus in the open menu on a mousedown on the trigger, so its click closes it', async () => {
    const user = userEvent.setup();
    render(<Page />);
    act(() => trigger().focus());
    await user.keyboard('{ArrowDown}');
    expect(item('Mark as completed')).toHaveFocus();

    expect(fireEvent.mouseDown(trigger())).toBe(false);
    expect(item('Mark as completed')).toHaveFocus();
    expect(menu()).toBeInTheDocument();
    fireEvent.click(trigger());
    expect(menu()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('lets a mousedown on the closed trigger do as usual', () => {
    render(<Page />);
    expect(fireEvent.mouseDown(trigger())).toBe(true);
  });

  // regression guard: opened on Space's keydown, focus would be on the first
  // item by its keyup, which Firefox takes as a click on that item.
  it('opens with Space on the keyup, not the keydown', () => {
    render(<Page />);
    act(() => trigger().focus());
    fireEvent.keyDown(trigger(), { key: ' ' });
    expect(menu()).toBeNull();
    fireEvent.keyUp(trigger(), { key: ' ' });
    expect(item('Mark as completed')).toHaveFocus();
    expect(picked).not.toHaveBeenCalled();
  });

  it.each([
    ['{Enter}', 'Mark as completed'],
    [' ', 'Mark as completed'],
    ['{ArrowDown}', 'Mark as completed'],
    ['{ArrowUp}', 'Save to my list'],
  ])('opens with %s on the trigger, focused on "%s"', async (key, focused) => {
    const user = userEvent.setup();
    render(<Page />);
    act(() => trigger().focus());
    await user.keyboard(key);
    expect(menu()).toBeInTheDocument();
    expect(item(focused)).toHaveFocus();
    // The key opened it and did nothing else: nothing was picked.
    expect(picked).not.toHaveBeenCalled();
  });

  it('renders nothing to open when it has no items', async () => {
    const user = userEvent.setup();
    render(<Page items={[]} />);
    await user.click(trigger());
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('Menu — keys in the menu', () => {
  async function openWithKeyboard() {
    const user = userEvent.setup();
    render(<Page />);
    act(() => trigger().focus());
    await user.keyboard('{ArrowDown}');
    return user;
  }

  it('moves with the arrow keys, wrapping round, and Home and End', async () => {
    const user = await openWithKeyboard();
    await user.keyboard('{ArrowDown}');
    expect(item('Move to draft')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(item('Mark as completed')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Save to my list')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Mark as completed')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Save to my list')).toHaveFocus();
  });

  it('moves to the next item starting with a typed letter', async () => {
    const user = await openWithKeyboard();
    await user.keyboard('s');
    expect(item('Save to my list')).toHaveFocus();
    await user.keyboard('M');
    expect(item('Mark as completed')).toHaveFocus();
    await user.keyboard('m');
    expect(item('Move to draft')).toHaveFocus();
    // No match: focus stays put.
    await user.keyboard('z');
    expect(item('Move to draft')).toHaveFocus();
  });

  it('picks the focused item with Enter, closing the menu with focus back on the trigger', async () => {
    const user = await openWithKeyboard();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(picked).toHaveBeenCalledExactlyOnceWith('draft');
    expect(menu()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it('picks the focused item with Space', async () => {
    const user = await openWithKeyboard();
    await user.keyboard('{End} ');
    expect(picked).toHaveBeenCalledExactlyOnceWith('save');
    expect(trigger()).toHaveFocus();
  });

  it('closes with Escape, with focus back on the trigger and nothing picked', async () => {
    const user = await openWithKeyboard();
    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(trigger()).toHaveFocus();
    expect(picked).not.toHaveBeenCalled();
  });

  // The browser then moves focus on from the trigger (jsdom has no Tab).
  it('closes with Tab, with focus back on the trigger to move on from', async () => {
    const user = await openWithKeyboard();
    await user.keyboard('{ArrowDown}');
    fireEvent.keyDown(item('Move to draft'), { key: 'Tab' });
    expect(menu()).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  // A dialog closes itself on Escape with a keydown listener on `document`;
  // here the React root (`container`) stands in for Next's, as in Select's test.
  it("keeps the open menu's keys from the listeners around it", async () => {
    const user = userEvent.setup();
    const { container } = render(<Page />);
    act(() => trigger().focus());
    const seen = { root: [] as string[], document: [] as string[] };
    const onRoot = (e: KeyboardEvent) => seen.root.push(e.key);
    const onDocument = (e: KeyboardEvent) => seen.document.push(e.key);
    container.addEventListener('keydown', onRoot);
    document.addEventListener('keydown', onDocument);
    try {
      await user.keyboard('{ArrowDown}');
      expect(menu()).toBeInTheDocument();
      await user.keyboard('{ArrowDown}{End}{Escape}');
      expect(menu()).toBeNull();
      // With the menu closed, Escape is the page's again.
      await user.keyboard('{Escape}');

      expect(seen.root).toEqual(['ArrowDown', 'Escape']);
      expect(seen.document).toEqual(['ArrowDown', 'Escape']);
    } finally {
      container.removeEventListener('keydown', onRoot);
      document.removeEventListener('keydown', onDocument);
    }
  });
});

describe('Menu — the pointer', () => {
  it('picks a clicked item, with focus on the trigger before its action runs', async () => {
    const user = userEvent.setup();
    let focusedOnSelect: Element | null = null;
    render(
      <Page
        items={[
          {
            label: 'Edit',
            onSelect: () => {
              focusedOnSelect = document.activeElement;
            },
          },
        ]}
      />
    );
    await user.click(trigger());
    await user.click(item('Edit'));
    // So a dialog the action opens records the trigger as its opener.
    expect(focusedOnSelect).toBe(trigger());
    expect(menu()).toBeNull();
  });

  it('moves focus (the highlight) with the pointer, and back to the menu when it leaves', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    await user.hover(item('Move to draft'));
    expect(item('Move to draft')).toHaveFocus();
    // The keyboard carries on from there.
    await user.keyboard('{ArrowDown}');
    expect(item('Save to my list')).toHaveFocus();
    await user.unhover(menu()!);
    expect(menu()).toHaveFocus();
  });

  it('closes on a click outside, without moving focus to the trigger', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'After' }));
    expect(menu()).toBeNull();
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus();
    expect(picked).not.toHaveBeenCalled();
  });

  it('closes when focus leaves it', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    act(() => screen.getByRole('button', { name: 'Before' }).focus());
    expect(menu()).toBeNull();
  });
});

describe('Menu — disabled items', () => {
  const held: MenuItem[] = [
    { label: 'Mark as completed', onSelect: () => picked('complete'), disabled: true },
    { label: 'Save to my list', onSelect: () => picked('save') },
  ];

  it('shows a disabled item, keeps it in the arrow keys, and does nothing when it is picked', async () => {
    const user = userEvent.setup();
    render(<Page items={held} />);
    act(() => trigger().focus());
    await user.keyboard('{ArrowDown}');
    expect(item('Mark as completed')).toHaveFocus();
    expect(item('Mark as completed')).toHaveAttribute('aria-disabled', 'true');
    expect(item('Save to my list')).not.toHaveAttribute('aria-disabled');

    await user.keyboard('{Enter}');
    await user.click(item('Mark as completed'));
    expect(picked).not.toHaveBeenCalled();
    // The menu stays open on it.
    expect(menu()).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(picked).toHaveBeenCalledExactlyOnceWith('save');
  });
});

describe('Menu — focus when its items change', () => {
  // regression guard: an item that went away with focus on it (a poll
  // re-rendering the card) left focus on <body>, and the open menu deaf to
  // its keys.
  it('moves focus to the menu when the focused item goes away, and its keys still work', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page />);
    act(() => trigger().focus());
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(item('Move to draft')).toHaveFocus();

    rerender(<Page items={[actions[0], actions[2]]} />);
    expect(menu()).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Mark as completed')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(trigger()).toHaveFocus();
  });

  it('puts focus back on the trigger when the menu closes because it has nothing left', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Page />);
    act(() => trigger().focus());
    await user.keyboard('{ArrowDown}');
    rerender(<Page items={[]} />);
    expect(menu()).toBeNull();
    expect(trigger()).toHaveFocus();
  });
});

describe('Menu — placement', () => {
  // jsdom lays nothing out, so the trigger's box and the menu's size are faked.
  function fakeLayout(trigger: Partial<DOMRect>, menuSize: { width: number; height: number }) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return { top: 0, bottom: 0, left: 0, right: 0, ...trigger } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(menuSize.height);
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(menuSize.width);
  }
  const H = window.innerHeight;
  const W = window.innerWidth;

  it('opens below the trigger, right-aligned with it, when there is room', async () => {
    fakeLayout({ top: 100, bottom: 140, left: W - 60, right: W - 20 }, { width: 200, height: 150 });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    expect(menu()!.parentElement!.className).toMatch(/\btop-full\b/);
    expect(menu()!.parentElement!.className).toMatch(/\bright-0\b/);
  });

  it('opens above the trigger when there is more room there than below', async () => {
    fakeLayout(
      { top: H - 60, bottom: H - 20, left: W - 60, right: W - 20 },
      { width: 200, height: 150 }
    );
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    expect(menu()!.parentElement!.className).toMatch(/\bbottom-full\b/);
  });

  it('aligns with the left edge of the trigger when right-aligned would run off the screen', async () => {
    fakeLayout({ top: 100, bottom: 140, left: 10, right: 50 }, { width: 200, height: 150 });
    const user = userEvent.setup();
    render(<Page />);
    await user.click(trigger());
    expect(menu()!.parentElement!.className).toMatch(/\bleft-0\b/);
  });
});

describe('Menu — a custom trigger, a header, links and a radio group (the account menu)', () => {
  const opened = vi.fn();

  /** An account-style menu: an avatar trigger, a header, links, a theme choice and an action. */
  function AccountPage() {
    const [theme, setTheme] = useState('light');
    const entries: MenuEntry[] = [
      { label: 'Your profile', icon: 'user', href: '#profile', onSelect: () => picked('profile') },
      { label: 'Settings', icon: 'settings', href: '#settings' },
      {
        type: 'radio-group',
        label: 'Theme',
        value: theme,
        options: [
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
        ],
        onChange: setTheme,
      },
      { label: 'Sign out', icon: 'logout', separated: true, onSelect: () => picked('signout') },
    ];
    return (
      <>
        <button>Before</button>
        <Menu
          label="Account menu"
          menuLabel="Account"
          trigger={(open) => <span data-testid="avatar">{open ? 'open' : 'closed'}</span>}
          header={<p>me@example.com</p>}
          onOpenChange={opened}
          items={entries}
        />
        <p data-testid="theme">{theme}</p>
      </>
    );
  }

  const accountTrigger = () => screen.getByRole('button', { name: 'Account menu' });
  const radio = (name: string) => screen.getByRole('menuitemradio', { name });
  const stops = () =>
    Array.from(menu()!.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')).map(
      (el) => el.textContent
    );

  beforeEach(() => opened.mockReset());

  async function openAccount() {
    const user = userEvent.setup();
    render(<AccountPage />);
    act(() => accountTrigger().focus());
    await user.keyboard('{Enter}');
    return user;
  }

  it('draws the custom trigger, told whether the menu is open, named by its label with no tooltip', async () => {
    const user = userEvent.setup();
    render(<AccountPage />);
    expect(accountTrigger()).toHaveTextContent('closed');
    expect(accountTrigger()).not.toHaveAttribute('title');
    expect(accountTrigger()).toHaveAttribute('aria-haspopup', 'menu');

    await user.click(accountTrigger());
    expect(accountTrigger()).toHaveTextContent('open');
    expect(menu()).toHaveAccessibleName('Account');
  });

  it('tells onOpenChange once each time it opens and closes', async () => {
    const user = await openAccount();
    expect(opened.mock.calls).toEqual([[true]]);
    await user.keyboard('{Escape}');
    expect(opened.mock.calls).toEqual([[true], [false]]);
  });

  it('shows the header outside the menu, so it is no item and the keys skip it', async () => {
    const user = await openAccount();
    const header = screen.getByText('me@example.com');
    expect(header).toBeVisible();
    expect(menu()).not.toContainElement(header);
    expect(stops()).toEqual(['Your profile', 'Settings', 'Light', 'Dark', 'Sign out']);

    // From the keyboard it opens on the first item, not the header.
    expect(item('Your profile')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Sign out')).toHaveFocus();
  });

  it('moves through the radio options in the arrow-key order, Home and End included', async () => {
    const user = await openAccount();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(radio('Light')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(radio('Dark')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Sign out')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(item('Your profile')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Sign out')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Your profile')).toHaveFocus();
    // Type-ahead reaches them too.
    await user.keyboard('d');
    expect(radio('Dark')).toHaveFocus();
  });

  it('groups the radio options under their name, and says which one is on', async () => {
    await openAccount();
    expect(screen.getByRole('group', { name: 'Theme' })).toContainElement(radio('Light'));
    expect(radio('Light')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Dark')).toHaveAttribute('aria-checked', 'false');
    for (const el of screen.getAllByRole('menuitemradio'))
      expect(el).toHaveAttribute('tabindex', '-1');
  });

  it('picks a radio option with Enter or Space, leaving the menu open on it', async () => {
    const user = await openAccount();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(radio('Dark')).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(radio('Dark')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Light')).toHaveAttribute('aria-checked', 'false');
    expect(menu()).toBeInTheDocument();
    expect(radio('Dark')).toHaveFocus();

    await user.keyboard('{ArrowUp} ');
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(radio('Light')).toHaveFocus();
    expect(picked).not.toHaveBeenCalled();
  });

  it('picks a radio option with a click, leaving the menu open', async () => {
    const user = userEvent.setup();
    render(<AccountPage />);
    await user.click(accountTrigger());
    await user.click(radio('Dark'));
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(menu()).toBeInTheDocument();
  });

  it('renders a link item as a link, which Enter follows, closing the menu to the trigger first', async () => {
    const user = await openAccount();
    const profile = item('Your profile');
    expect(profile.tagName).toBe('A');
    expect(profile).toHaveAttribute('href', '#profile');
    expect(profile).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{Enter}');
    expect(picked).toHaveBeenCalledExactlyOnceWith('profile');
    expect(menu()).toBeNull();
    expect(accountTrigger()).toHaveFocus();
  });

  it('follows a link item with Space too', async () => {
    const user = await openAccount();
    const followed = vi.fn((e: Event) => e.preventDefault());
    item('Settings').addEventListener('click', followed);
    await user.keyboard('{ArrowDown} ');
    expect(followed).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    expect(accountTrigger()).toHaveFocus();
  });

  it('closes with Escape and with Tab, with focus back on the trigger', async () => {
    const user = await openAccount();
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(radio('Light')).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(accountTrigger()).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(item('Your profile')).toHaveFocus();
    fireEvent.keyDown(item('Your profile'), { key: 'Tab' });
    expect(menu()).toBeNull();
    expect(accountTrigger()).toHaveFocus();
  });
});
