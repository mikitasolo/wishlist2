// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import Select, { type SelectOption } from '@/components/Select';

const onPick = vi.fn();

beforeEach(() => {
  cleanup();
  onPick.mockReset();
});
afterEach(() => vi.useRealTimers());

const options = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'price', label: 'Price' },
];

/** A Select on a page, outside any dialog, between two buttons. */
function SortPage({
  initial = 'oldest',
  choices = options,
  disabled = false,
}: {
  initial?: string;
  choices?: SelectOption[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <button>Before</button>
      <Select
        value={value}
        onChange={(v) => {
          onPick(v);
          setValue(v);
        }}
        options={choices}
        ariaLabel="Sort by"
        disabled={disabled}
      />
      <button>After</button>
    </>
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Sort by' });
const button = (name: string) => screen.getByRole('button', { name });
const option = (name: string) => screen.getByRole('option', { name });
const menu = () => screen.queryByRole('listbox');
/** The option the keyboard is on, as the trigger announces it. */
const activeOption = () => {
  const id = trigger().getAttribute('aria-activedescendant');
  return id ? document.getElementById(id) : null;
};

type User = ReturnType<typeof userEvent.setup>;

/** Renders the page and tabs to the trigger. */
async function tabToTrigger(page = <SortPage />, user: User = userEvent.setup()) {
  render(page);
  await user.tab();
  await user.tab();
  expect(trigger()).toHaveFocus();
  return user;
}

describe('Select — from the keyboard, on a page', () => {
  // regression: the menu is portalled to <body>, and its options were buttons,
  // so on a page they came after everything else in the Tab order: the
  // keyboard could open the menu but not reach an option.
  it.each([
    { name: 'Enter', key: '{Enter}' },
    { name: 'Space', key: ' ' },
    { name: 'ArrowDown', key: '{ArrowDown}' },
    { name: 'ArrowUp', key: '{ArrowUp}' },
  ])(
    'regression: $name opens the menu on the selected option, with focus left on the trigger',
    async ({ key }) => {
      const user = await tabToTrigger();

      await user.keyboard(key);
      expect(menu()).toBeInTheDocument();
      expect(trigger()).toHaveAttribute('aria-expanded', 'true');
      expect(activeOption()).toBe(option('Oldest'));
      expect(trigger()).toHaveFocus();
      expect(onPick).not.toHaveBeenCalled();
    }
  );

  it('moves between the options with the arrow keys, Home and End, stopping at the ends', async () => {
    const user = await tabToTrigger();
    await user.keyboard('{ArrowDown}');

    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toBe(option('Price'));
    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toBe(option('Price'));
    await user.keyboard('{Home}');
    expect(activeOption()).toBe(option('Newest'));
    await user.keyboard('{ArrowUp}');
    expect(activeOption()).toBe(option('Newest'));
    await user.keyboard('{End}');
    expect(activeOption()).toBe(option('Price'));
    await user.keyboard('{ArrowUp}');
    expect(activeOption()).toBe(option('Oldest'));

    // Only the keyboard's option is highlighted, and the value hasn't moved.
    expect(option('Oldest')).toHaveClass('bg-row-active');
    expect(option('Price')).not.toHaveClass('bg-row-active');
    expect(trigger()).toHaveTextContent('Oldest');
    expect(trigger()).toHaveFocus();
  });

  it.each([
    { key: '{Home}', lands: 'Newest' },
    { key: '{End}', lands: 'Price' },
  ])('$key opens the menu at that end', async ({ key, lands }) => {
    const user = await tabToTrigger();

    await user.keyboard(key);
    expect(activeOption()).toBe(option(lands));
  });

  // regression: choosing removed the focused option along with the menu, and
  // focus dropped to <body>.
  it.each([
    { name: 'Enter', key: '{Enter}' },
    { name: 'Space', key: ' ' },
  ])(
    'regression: $name picks the active option and closes the menu, with focus on the trigger',
    async ({ key }) => {
      const user = await tabToTrigger();
      await user.keyboard('{ArrowDown}{ArrowDown}');

      await user.keyboard(key);
      expect(menu()).toBeNull();
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith('price');
      expect(trigger()).toHaveTextContent('Price');
      expect(trigger()).toHaveAttribute('aria-expanded', 'false');
      expect(trigger()).not.toHaveAttribute('aria-activedescendant');
      expect(trigger()).toHaveFocus();

      // And it opens again on the new value.
      await user.keyboard('{ArrowDown}');
      expect(activeOption()).toBe(option('Price'));
    }
  );

  it('closes with Escape without changing the value, with focus on the trigger', async () => {
    const user = await tabToTrigger();
    await user.keyboard('{ArrowDown}{ArrowDown}');

    await user.keyboard('{Escape}');
    expect(menu()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
    expect(trigger()).toHaveTextContent('Oldest');
    expect(trigger()).toHaveFocus();
  });

  it('is one Tab stop: Tab and Shift+Tab close the menu without picking and move on', async () => {
    const user = await tabToTrigger();

    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.tab();
    expect(button('After')).toHaveFocus();
    expect(menu()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();

    await user.tab({ shift: true });
    expect(trigger()).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab({ shift: true });
    expect(button('Before')).toHaveFocus();
    expect(menu()).toBeNull();
    expect(trigger()).toHaveTextContent('Oldest');
  });

  it('closes the menu when focus leaves the trigger any other way', async () => {
    await tabToTrigger().then((user) => user.keyboard('{Enter}'));

    act(() => button('After').focus());
    expect(menu()).toBeNull();
    expect(button('After')).toHaveFocus();
  });

  it('starts on the first option when nothing is selected yet', async () => {
    const user = await tabToTrigger(<SortPage initial="" />);

    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toBe(option('Newest'));
  });

  it('exposes the select-only combobox pattern to assistive tech', async () => {
    const user = await tabToTrigger();
    expect(trigger()).toHaveAttribute('aria-haspopup', 'listbox');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(trigger()).not.toHaveAttribute('aria-controls');

    await user.keyboard('{Enter}');
    const listbox = screen.getByRole('listbox', { name: 'Sort by' });
    expect(trigger()).toHaveAttribute('aria-controls', listbox.id);
    // aria-selected marks the value; the keyboard's option is the active one.
    await user.keyboard('{ArrowDown}');
    expect(option('Oldest')).toHaveAttribute('aria-selected', 'true');
    expect(option('Price')).toHaveAttribute('aria-selected', 'false');
    expect(activeOption()).toBe(option('Price'));
    // No option is a Tab stop of its own.
    for (const o of screen.getAllByRole('option')) expect(o).not.toHaveAttribute('tabindex');
  });
});

describe('Select — type-ahead', () => {
  const fruit = ['Apple', 'Apricot', 'Banana', 'Black tea', 'Blueberry'].map((label) => ({
    value: label.toLowerCase(),
    label,
  }));
  const page = <SortPage initial="apple" choices={fruit} />;

  it('opens on the first option starting with a typed letter, and cycles on that letter', async () => {
    const user = await tabToTrigger(page);

    await user.keyboard('b');
    expect(menu()).toBeInTheDocument();
    expect(activeOption()).toBe(option('Banana'));
    await user.keyboard('b');
    expect(activeOption()).toBe(option('Black tea'));
    await user.keyboard('b');
    expect(activeOption()).toBe(option('Blueberry'));
    await user.keyboard('b');
    expect(activeOption()).toBe(option('Banana'));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('matches the letters typed in a row, a space among them, until a pause', async () => {
    // Still advancing with real time, for Testing Library's own waits.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    const user = await tabToTrigger(page);

    await user.keyboard('apr');
    expect(activeOption()).toBe(option('Apricot'));

    // A pause starts a new search.
    act(() => vi.advanceTimersByTime(500));
    await user.keyboard('black t');
    // The space was part of the search, not a pick.
    expect(menu()).toBeInTheDocument();
    expect(activeOption()).toBe(option('Black tea'));

    // Space picks again once another key has ended the search.
    await user.keyboard('{ArrowDown}{ArrowUp} ');
    expect(menu()).toBeNull();
    expect(onPick).toHaveBeenCalledWith('black tea');
  });

  it('leaves the active option where it is when nothing matches', async () => {
    const user = await tabToTrigger(page);
    await user.keyboard('{ArrowDown}{ArrowDown}');

    await user.keyboard('z');
    expect(activeOption()).toBe(option('Apricot'));
  });
});

describe('Select — type-ahead on a day picker', () => {
  const days = Array.from({ length: 31 }, (_, i) => ({
    value: String(i + 1),
    label: String(i + 1),
  }));

  it.each([
    { typed: '11', lands: '11' },
    { typed: '22', lands: '22' },
    { typed: '3', lands: '3' },
    { typed: '31', lands: '31' },
  ])('goes to day $lands when $typed is typed', async ({ typed, lands }) => {
    const user = await tabToTrigger(<SortPage initial="" choices={days} />);

    await user.keyboard(typed);
    expect(activeOption()).toBe(option(lands));
  });

  it('cycles on a repeated digit once the whole run matches nothing', async () => {
    const user = await tabToTrigger(<SortPage initial="" choices={days} />);

    // "1", "11", then "111" matches no day: on to the next one starting with 1.
    await user.keyboard('111');
    expect(activeOption()).toBe(option('12'));
  });
});

describe('Select — with the mouse', () => {
  it('opens on a click with nothing highlighted, and picks on a click, focusing the trigger', async () => {
    const user = userEvent.setup();
    render(<SortPage />);

    await user.click(trigger());
    expect(menu()).toBeInTheDocument();
    for (const o of screen.getAllByRole('option')) expect(o).not.toHaveClass('bg-row-active');

    await user.click(option('Price'));
    expect(menu()).toBeNull();
    expect(onPick).toHaveBeenCalledWith('price');
    expect(trigger()).toHaveTextContent('Price');
    expect(trigger()).toHaveFocus();
  });

  it('closes on a second click on the trigger', async () => {
    const user = userEvent.setup();
    render(<SortPage />);

    await user.click(trigger());
    await user.click(trigger());
    expect(menu()).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('leaves focus alone when a click elsewhere closes the menu', async () => {
    const user = userEvent.setup();
    render(<SortPage />);
    await user.click(trigger());

    await user.click(button('After'));
    expect(menu()).toBeNull();
    expect(button('After')).toHaveFocus();
  });

  it('arrows on from the option under the pointer, which it highlights', async () => {
    const user = userEvent.setup();
    render(<SortPage />);
    await user.click(trigger());

    await user.hover(option('Newest'));
    expect(activeOption()).toBe(option('Newest'));
    expect(option('Newest')).toHaveClass('bg-row-active');
    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toBe(option('Oldest'));
    expect(option('Oldest')).toHaveClass('bg-row-active');
    expect(option('Newest')).not.toHaveClass('bg-row-active');
  });

  it('picks the option under the pointer with Enter, as highlighted', async () => {
    const user = userEvent.setup();
    render(<SortPage />);
    await user.click(trigger());
    await user.hover(option('Price'));

    await user.keyboard('{Enter}');
    expect(menu()).toBeNull();
    expect(onPick).toHaveBeenCalledWith('price');
  });

  // Nothing is highlighted in a menu opened with a click, so a key there
  // mustn't pick an option the user can't see is the active one.
  it.each([
    { name: 'Enter', key: '{Enter}' },
    { name: 'Space', key: ' ' },
  ])(
    '$name after a click shows the keyboard on the selected option, and only the next one picks',
    async ({ key }) => {
      const user = userEvent.setup();
      render(<SortPage />);
      await user.click(trigger());
      expect(trigger()).not.toHaveAttribute('aria-activedescendant');

      await user.keyboard(key);
      expect(menu()).toBeInTheDocument();
      expect(onPick).not.toHaveBeenCalled();
      expect(activeOption()).toBe(option('Oldest'));
      expect(option('Oldest')).toHaveClass('bg-row-active');

      await user.keyboard(key);
      expect(menu()).toBeNull();
      expect(onPick).toHaveBeenCalledWith('oldest');
    }
  );

  it('picks nothing with Enter in a placeholder menu opened with a click, and starts on the first option', async () => {
    const user = userEvent.setup();
    render(<SortPage initial="" />);
    await user.click(trigger());

    await user.keyboard('{Enter}');
    expect(onPick).not.toHaveBeenCalled();
    expect(activeOption()).toBe(option('Newest'));
  });

  it('starts the arrow keys on the selected option after a click, and Home and End at the ends', async () => {
    const user = userEvent.setup();
    render(<SortPage />);

    await user.click(trigger());
    await user.keyboard('{ArrowUp}');
    expect(activeOption()).toBe(option('Oldest'));
    await user.keyboard('{ArrowUp}');
    expect(activeOption()).toBe(option('Newest'));

    await user.click(trigger());
    await user.click(trigger());
    await user.keyboard('{End}');
    expect(activeOption()).toBe(option('Price'));
  });
});

describe('Select — modified keys', () => {
  it('leaves a key with Ctrl, Alt or Cmd to the button, so Ctrl+Space clicks it open', async () => {
    const user = await tabToTrigger();

    await user.keyboard('{Control>}{ArrowDown}{/Control}');
    expect(menu()).toBeNull();
    await user.keyboard('{Control>} {/Control}');
    expect(menu()).toBeInTheDocument();
    expect(trigger()).not.toHaveAttribute('aria-activedescendant');
  });
});

describe('Select — disabled', () => {
  it('is no Tab stop and opens on nothing', async () => {
    const user = userEvent.setup();
    render(<SortPage disabled />);

    await user.tab();
    await user.tab();
    expect(button('After')).toHaveFocus();
    await user.click(trigger());
    expect(menu()).toBeNull();
  });

  it('closes an open menu when it becomes disabled', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SortPage />);
    await user.click(trigger());
    expect(menu()).toBeInTheDocument();

    rerender(<SortPage disabled />);
    expect(menu()).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('Select — keys around it', () => {
  // A dialog closes itself on Escape with a keydown listener on `document`.
  // Outside a portal, React handles the trigger's keys on `document` too
  // (Next's root), ahead of it. Here the root is `container`, so a listener on
  // it added after the render stands in for that dialog's.
  it("keeps the menu's keys from the listeners around it, and hands them on once it's closed", async () => {
    const user = userEvent.setup();
    const { container } = render(<SortPage />);
    act(() => trigger().focus());
    const seen = { root: [] as string[], document: [] as string[] };
    const onRoot = (e: KeyboardEvent) => seen.root.push(e.key);
    const onDocument = (e: KeyboardEvent) => seen.document.push(e.key);
    container.addEventListener('keydown', onRoot);
    document.addEventListener('keydown', onDocument);
    try {
      await user.keyboard('{Enter}');
      expect(menu()).toBeInTheDocument();

      await user.keyboard('{ArrowDown}{Escape}');
      expect(menu()).toBeNull();
      // With the menu closed, Escape is the page's again.
      await user.keyboard('{Escape}');

      // Opening it is the page's to see too; only the open menu's keys aren't.
      expect(seen.root).toEqual(['Enter', 'Escape']);
      expect(seen.document).toEqual(['Enter', 'Escape']);
    } finally {
      container.removeEventListener('keydown', onRoot);
      document.removeEventListener('keydown', onDocument);
    }
  });
});

describe('Select — placeholder', () => {
  function Picker() {
    const [value, setValue] = useState('');
    return (
      <Select
        value={value}
        onChange={setValue}
        options={options}
        ariaLabel="Sort by"
        placeholder="Pick one"
      />
    );
  }

  it('shows the placeholder, muted, until an option is picked, then the option', async () => {
    const user = userEvent.setup();
    render(<Picker />);
    expect(trigger()).toHaveTextContent('Pick one');
    expect(screen.getByText('Pick one')).toHaveClass('text-muted-foreground');
    // The placeholder isn't an option of its own.
    await user.click(trigger());
    expect(screen.queryByRole('option', { name: 'Pick one' })).toBeNull();

    await user.click(option('Price'));
    expect(trigger()).toHaveTextContent('Price');
    expect(screen.queryByText('Pick one')).toBeNull();
  });

  it('shows nothing when no option matches and there is no placeholder', () => {
    render(<Select value="" onChange={() => {}} options={options} ariaLabel="Sort by" />);
    expect(trigger()).toHaveTextContent(/^$/);
  });
});

describe('Select — a second press on the trigger', () => {
  // regression: Safari and Firefox on macOS do not focus a clicked button, so the
  // mousedown blurred the trigger, the blur closed the menu, and the click that
  // followed opened it again (WIS-315). The open menu's trigger cancels the
  // mousedown so focus never leaves it; a closed one does not (it takes focus).
  it('cancels the trigger mousedown only while the menu is open', async () => {
    const user = userEvent.setup();
    render(<SortPage />);
    // fireEvent returns false when the event was cancelled.
    expect(fireEvent.mouseDown(trigger())).toBe(true);
    await user.click(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(fireEvent.mouseDown(trigger())).toBe(false);
    await user.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Select menu placement (WIS-214)', () => {
  const rectAt = (top: number): DOMRect =>
    ({
      top,
      bottom: top + 36,
      left: 20,
      right: 220,
      width: 200,
      height: 36,
      x: 20,
      y: top,
    }) as DOMRect;
  const many = Array.from({ length: 12 }, (_, i) => ({ value: `o${i}`, label: `Option ${i}` }));
  let triggerTop = 0;

  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 720 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() =>
      rectAt(triggerTop)
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens below the trigger when there is room', async () => {
    triggerTop = 100;
    render(<SortPage />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
    const menu = screen.getByRole('listbox', { name: 'Sort by' });
    expect(menu.style.top).toBe('142px');
    expect(menu.style.bottom).toBe('');
  });

  it('flips above the trigger, capped to the room there, when there is none below', async () => {
    triggerTop = 650;
    render(<SortPage choices={many} initial="o0" />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
    const menu = screen.getByRole('listbox', { name: 'Sort by' });
    expect(menu.style.top).toBe('');
    expect(menu.style.bottom).toBe(`${720 - 650 + 6}px`);
    expect(menu.style.maxHeight).toBe('288px');
  });

  it('caps the height to the room on the roomier side when neither fits', async () => {
    triggerTop = 200;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    render(<SortPage choices={many} initial="o0" />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
    const menu = screen.getByRole('listbox', { name: 'Sort by' });
    // 300 - 236 - 14 = 50 below, 200 - 14 = 186 above.
    expect(menu.style.bottom).toBe('106px');
    expect(menu.style.maxHeight).toBe('186px');
  });

  it('keeps following the trigger on scroll, flipping as the room changes', async () => {
    triggerTop = 100;
    render(<SortPage choices={many} initial="o0" />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Sort by' }));
    const menu = screen.getByRole('listbox', { name: 'Sort by' });
    expect(menu.style.top).toBe('142px');
    triggerTop = 650;
    fireEvent.scroll(window);
    expect(screen.getByRole('listbox', { name: 'Sort by' }).style.bottom).toBe('76px');
  });
});
