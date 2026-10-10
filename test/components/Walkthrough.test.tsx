// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, showToast, track, nav } = vi.hoisted(() => {
  const nav = { pathname: '/' };
  return {
    // Going to a page is landing on it.
    push: vi.fn((path: string) => {
      nav.pathname = path.split('?')[0];
    }),
    showToast: vi.fn(),
    track: vi.fn(),
    nav,
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => nav.pathname,
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/analytics', () => ({ track }));

import Walkthrough, { TOUR_AGAIN_TOAST } from '@/components/Walkthrough';
import { resetWalkthroughForTests, tourListCreated } from '@/components/walkthroughStore';
import TourSetting from '@/components/TourSetting';
import type { WalkthroughStatus } from '@/lib/utils/walkthrough';

const fetchMock = vi.fn();

/** `GET /api/users/me` answers this walkthrough status; every PATCH succeeds. */
function answer(partial: Omit<WalkthroughStatus, 'listPath'> & { listPath?: string | null }) {
  const status: WalkthroughStatus = { listPath: null, ...partial };
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') return new Response(JSON.stringify({ success: true }));
    return new Response(JSON.stringify({ success: true, data: { walkthrough: status } }));
  });
}

/** The walkthrough answers PATCHed, in order. */
const sent = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === 'PATCH')
    .map(([, init]) => JSON.parse(init.body).walkthrough);

/** A device with a mouse from `sm` up (`true`), or a phone (`false`). */
function device(desktop: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduced-motion') ? true : desktop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** A step's dialog: the popover beside its target, or the centred card once the search gives up. */
const step = (name: string) => screen.findByRole('dialog', { name }, { timeout: 4500 });

beforeEach(() => {
  resetWalkthroughForTests();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  nav.pathname = '/';
  window.history.replaceState(null, '', '/');
  device(false);
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('[data-tour], [data-test-overlay]').forEach((el) => el.remove());
  vi.unstubAllGlobals();
  // @ts-expect-error jsdom has none of its own
  delete window.matchMedia;
});

/** Each step a phone shows, in order (no bookmarklet). */
const PHONE_STEPS = [
  'Lists for every occasion',
  'Adding items',
  'Sharing',
  'Find your friends',
  'The surprise stays a surprise',
  'Group gifts',
  'Reserved',
  'No spoiler mode',
];

/** Clicks Next through these steps. */
async function nextThrough(names: string[]) {
  for (const name of names) {
    await userEvent.click(within(await step(name)).getByRole('button', { name: 'Next' }));
  }
}

/** A `data-tour` target on the page, drawn where the tour can point at it. */
function addTarget(name: string, tag: 'div' | 'button' = 'button') {
  const el = document.createElement(tag);
  el.dataset.tour = name;
  el.getBoundingClientRect = () => ({ top: 100, left: 20, width: 120, height: 40 }) as DOMRect;
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

/** Every step's target, as if each page had it (the test's pages are all one document). */
function addAllTargets() {
  const names = [
    'new-list',
    'add-item',
    'share',
    'search',
    'reserve',
    'group-gift',
    'reserved',
    'no-spoiler',
    'bookmarklet',
  ];
  return Object.fromEntries(names.map((name) => [name, addTarget(name)]));
}

/** The pages the tour has taken them to, in order. */
const visited = () => push.mock.calls.map(([path]) => path);

describe('Walkthrough', () => {
  it('falls back to a centred card with a made-up picture where a target never shows', async () => {
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    const card = await step('Lists for every occasion');
    expect(card).toHaveAttribute('aria-modal', 'true');
    expect(card).toHaveTextContent('1 of 8');
    // Its made-up picture, decorative only; nothing to try with no control on screen.
    expect(card).toHaveTextContent('Maya’s birthday');
    expect(card).not.toHaveTextContent('Tap New list');
    expect(track).toHaveBeenCalledWith('tour_started', { source: 'auto' });
  }, 8000);

  it('dims the page around the real control, saying what to try, with no picture', async () => {
    const target = addTarget('new-list');
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    const popover = await step('Lists for every occasion');
    expect(popover).not.toHaveAttribute('aria-modal');
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(popover).toHaveTextContent('Tap New list to start one, or press Next.');
    expect(popover).not.toHaveTextContent('Maya’s birthday');
    // Focus on Next, so Enter goes on rather than skipping.
    expect(within(popover).getByRole('button', { name: 'Next' })).toHaveFocus();
  });

  // regression: the popover listened for Escape on the whole document, so
  // Escape closing a dialog opened from the highlighted control skipped the tour.
  it('leaves Escape pressed outside the popover to whatever has focus', async () => {
    const target = addTarget('new-list');
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    const popover = await step('Lists for every occasion');
    act(() => target.focus());
    await userEvent.keyboard('{Escape}');
    expect(popover).toBeInTheDocument();
    expect(sent()).toEqual([]);
  });

  it('takes them to each step’s page: their own list, the practice list, Reserved, Settings, Home', async () => {
    device(true);
    addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    expect(await step('Lists for every occasion')).toHaveTextContent('1 of 9');
    await nextThrough([...PHONE_STEPS, 'Add from any store']);
    expect(await step('That’s it')).toBeInTheDocument();
    expect(visited()).toEqual(['/wishlists/maya', '/tour', '/booked', '/settings', '/']);
  });

  it('runs the steps about a list of their own on the practice one when they have none', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    await nextThrough(['Lists for every occasion']);
    expect(await step('Adding items')).toBeInTheDocument();
    expect(visited()).toEqual(['/tour/mine']);
  });

  // regression: the step moved on 450ms after New list's dialog closed, before
  // the app's own push to the new list, and sent them to the practice list.
  it('carries on in a list they make at the New list step, and stops offering one', async () => {
    const newList = addTarget('new-list');
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    await step('Lists for every occasion');
    await userEvent.click(newList);
    // New list's dialog makes the list, then closes, before the page changes.
    act(() => tourListCreated('/wishlists/brand-new'));
    addTarget('add-item');
    addTarget('share');
    expect(await step('Adding items')).toBeInTheDocument();
    expect(visited()).toEqual(['/wishlists/brand-new']);

    addAllTargets();
    await nextThrough(PHONE_STEPS.slice(1));
    const closing = await step('That’s it');
    expect(within(closing).queryByRole('button', { name: 'Create a list' })).toBeNull();
  });

  it('moves on when the try-it control is used, once the dialog it opened closes', async () => {
    const { 'add-item': addItem } = addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(['Lists for every occasion']);
    await step('Adding items');

    // The tile opens Add item: the tour steps aside and waits for it.
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    dialog.dataset.testOverlay = '';
    addItem.addEventListener('click', () => document.body.appendChild(dialog));
    await userEvent.click(addItem);
    expect(screen.queryByRole('dialog', { name: 'Adding items' })).toBeNull();
    await act(() => new Promise((r) => setTimeout(r, 800)));
    expect(screen.queryByRole('dialog', { name: 'Sharing' })).toBeNull();

    dialog.remove();
    expect(await step('Sharing')).toBeInTheDocument();
  });

  it('reads again on the next page after a failed read', async () => {
    addTarget('new-list');
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const { rerender } = render(<Walkthrough userId="u1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    answer({ due: 'tour', ownsList: false });
    nav.pathname = '/booked';
    rerender(<Walkthrough userId="u1" />);
    expect(await step('Lists for every occasion')).toBeInTheDocument();
  });

  it('skipping says where to find it again and records it', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(['Lists for every occasion']);
    const card = await step('Adding items');
    await userEvent.click(within(card).getByRole('button', { name: 'Skip tour' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', {
      action: { label: 'Open Settings', href: '/settings#tour' },
    });
    await waitFor(() => expect(sent()).toEqual(['skipped']));
    await waitFor(() => expect(track).toHaveBeenCalledWith('tour_skipped', { step: 'items' }));
  });

  it('skipping on the practice list goes Home', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS.slice(0, 4));
    const card = await step('The surprise stays a surprise');
    window.history.replaceState(null, '', '/tour');
    await userEvent.click(within(card).getByRole('button', { name: 'Skip tour' }));
    expect(visited().at(-1)).toBe('/');
    await waitFor(() => expect(track).toHaveBeenCalledWith('tour_skipped', { step: 'reserving' }));
  });

  it('Escape skips', async () => {
    addTarget('new-list');
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    await step('Lists for every occasion');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(sent()).toEqual(['skipped']));
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
  });

  it('Back goes a step back, and to its page', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(['Lists for every occasion']);
    await userEvent.click(within(await step('Adding items')).getByRole('button', { name: 'Back' }));
    expect(await step('Lists for every occasion')).toBeInTheDocument();
    expect(visited()).toEqual(['/wishlists/maya', '/']);
  });

  it('ends on the closing card, whose Done or close finishes it', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS);
    const closing = await step('That’s it');
    expect(closing).toHaveTextContent('Coming up on Home shows friends’ birthdays and occasions.');
    expect(within(closing).queryByRole('button', { name: 'Skip tour' })).toBeNull();
    // They have a list: nothing to start.
    expect(within(closing).queryByRole('button', { name: 'Create a list' })).toBeNull();
    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
    await waitFor(() => expect(sent()).toEqual(['completed']));
    await waitFor(() => expect(track).toHaveBeenCalledWith('tour_finished'));
  });

  it('offers Create a list at the end to someone with no list, which opens New list', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS);
    const closing = await step('That’s it');
    expect(nav.pathname).toBe('/');
    const opened = vi.fn();
    window.addEventListener('open-new-list', opened);
    await userEvent.click(within(closing).getByRole('button', { name: 'Create a list' }));
    window.removeEventListener('open-new-list', opened);
    expect(opened).toHaveBeenCalled();
    await waitFor(() => expect(sent()).toEqual(['completed']));
  });

  it('leaves out the bookmarklet step on a phone', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS);
    expect(await step('That’s it')).toBeInTheDocument();
    expect(visited()).not.toContain('/settings');
  });

  it('offers the tour after time away; dismissing it says where to find it', async () => {
    answer({ due: 'offer', ownsList: true });
    render(<Walkthrough userId="u1" />);
    const offer = await step('Want a quick look around?');
    await userEvent.click(within(offer).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
    await waitFor(() => expect(sent()).toEqual(['offer_dismissed']));
    await waitFor(() => expect(track).toHaveBeenCalledWith('tour_offer_dismissed'));
  });

  it('accepting the offer starts the tour', async () => {
    addTarget('new-list');
    answer({ due: 'offer', ownsList: true });
    render(<Walkthrough userId="u1" />);
    const offer = await step('Want a quick look around?');
    await userEvent.click(within(offer).getByRole('button', { name: 'Take the tour' }));
    expect(await step('Lists for every occasion')).toBeInTheDocument();
    await waitFor(() => expect(sent()).toEqual(['offer_accepted']));
    expect(track).toHaveBeenCalledWith('tour_started', { source: 'offer' });
  });

  it('shows nothing when nothing is due, and reads once per tab', async () => {
    answer({ due: null, ownsList: true });
    const { rerender } = render(<Walkthrough userId="u1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    nav.pathname = '/booked';
    rerender(<Walkthrough userId="u1" />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('starts at once from Settings’ link, taking the marker off the URL', async () => {
    addTarget('new-list');
    window.history.replaceState(null, '', '/?tour=start');
    answer({ due: null, ownsList: true });
    render(<Walkthrough userId="u1" />);
    expect(await step('Lists for every occasion')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(track).toHaveBeenCalledWith('tour_started', { source: 'settings' });
  });

  it('never runs on the bookmarklet page, nor over a list just joined', async () => {
    answer({ due: 'tour', ownsList: false });
    nav.pathname = '/items/new';
    const { unmount } = render(<Walkthrough userId="u1" />);
    await act(async () => {});
    unmount();

    nav.pathname = '/wishlists/abc';
    window.history.replaceState(null, '', '/wishlists/abc?welcome=1');
    render(<Walkthrough userId="u1" />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('TourSetting', () => {
  it('resets the tour and starts it on Home', async () => {
    answer({ due: 'tour', ownsList: true });
    render(<TourSetting />);
    await userEvent.click(screen.getByRole('button', { name: 'Take the tour again' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/?tour=start'));
    expect(sent()).toEqual(['restart']);
  });

  it('says so when it can’t', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    render(<TourSetting />);
    await userEvent.click(screen.getByRole('button', { name: 'Take the tour again' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Couldn’t start the tour. Try again.', 'error')
    );
    expect(push).not.toHaveBeenCalled();
  });
});
