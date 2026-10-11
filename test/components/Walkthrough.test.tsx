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
import {
  markTourRunning,
  resetWalkthroughForTests,
  TOUR_BEAT_FRESH_MS,
  tourListCreated,
  tourRunningElsewhere,
} from '@/components/walkthroughStore';
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

  // regression: the spotlight was always `rounded-2xl`, so round a pill
  // button it left the page's undimmed corners showing.
  it('shapes the spotlight like the control it rings', async () => {
    const target = addTarget('new-list');
    target.style.borderTopLeftRadius = '9999px';
    target.style.borderTopRightRadius = '9999px';
    target.style.borderBottomRightRadius = '9999px';
    target.style.borderBottomLeftRadius = '9999px';
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    await step('Lists for every occasion');
    const spotlight = document.querySelector<HTMLElement>('div[aria-hidden="true"][style]');
    // Half its 40px height, plus the 4px the hole reaches past it.
    expect(spotlight?.style.borderRadius).toBe('24px 24px 24px 24px');
    expect(spotlight?.style.top).toBe('96px');
    expect(spotlight?.style.height).toBe('48px');
  });

  // regression: the Share target is a `display: contents` wrapper, which has no
  // box to scroll to, so the Sharing step pointed at a button out of view.
  it('scrolls to the node that draws a display: contents target', async () => {
    const wrapper = document.createElement('span');
    wrapper.dataset.tour = 'new-list';
    wrapper.getBoundingClientRect = () => ({ top: 0, left: 0, width: 0, height: 0 }) as DOMRect;
    wrapper.scrollIntoView = vi.fn();
    const button = document.createElement('button');
    button.getBoundingClientRect = () =>
      ({ top: 100, left: 20, width: 120, height: 40 }) as DOMRect;
    button.scrollIntoView = vi.fn();
    wrapper.appendChild(button);
    document.body.appendChild(wrapper);
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    await step('Lists for every occasion');
    expect(button.scrollIntoView).toHaveBeenCalled();
    expect(wrapper.scrollIntoView).not.toHaveBeenCalled();
  });

  // regression: the Find your friends popover covered the search's results.
  it('steps aside while they type in the search it points at', async () => {
    addAllTargets();
    const search = document.querySelector<HTMLElement>('[data-tour="search"]')!;
    const field = document.createElement('input');
    search.appendChild(field);
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS.slice(0, 3));
    await step('Find your friends');

    act(() => field.focus());
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Find your friends' })).toBeNull()
    );
    act(() => field.blur());
    expect(await step('Find your friends')).toBeInTheDocument();
  });

  it('shows the closing card as a popover like every step, not a dialog with a close button', async () => {
    addAllTargets();
    answer({ due: 'tour', ownsList: true, listPath: '/wishlists/maya' });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS);
    const closing = await step('That’s it');
    expect(within(closing).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(closing.parentElement?.className).not.toContain('backdrop-blur');
    expect(within(closing).getByRole('button', { name: 'Done' })).toHaveFocus();
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

  // regression: a list made at the New list step without the step seeing the
  // click (New list pressed before its target was found) left the New list
  // step open, so it showed again over the new list, which has no New list.
  it('moves on to Adding items in a list made at the New list step, however it was reached', async () => {
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    // No New list target: the step is the centred card, and nothing marks it used.
    await step('Lists for every occasion');
    act(() => tourListCreated('/wishlists/brand-new'));
    addTarget('add-item');
    expect(await step('Adding items')).toBeInTheDocument();
    expect(visited()).toEqual(['/wishlists/brand-new']);
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

  // regression: a page opened in a new tab mid-tour (the bookmarklet's) read
  // the tour as due and started it over at step 1 there.
  it('leaves a tour running in another tab to that tab', async () => {
    addTarget('new-list');
    answer({ due: 'tour', ownsList: false });
    // Another tab's heartbeat: this tab's own id differs, so stamp a foreign one.
    localStorage.setItem(
      'tour-running',
      JSON.stringify({ userId: 'u1', tab: 'other-tab', at: Date.now() })
    );
    render(<Walkthrough userId="u1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(track).not.toHaveBeenCalledWith('tour_started', expect.anything());
  });

  it('marks the tour as running while it runs here, and stops once it ends', async () => {
    addTarget('new-list');
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    const first = await step('Lists for every occasion');
    expect(JSON.parse(localStorage.getItem('tour-running')!)).toMatchObject({ userId: 'u1' });
    // Its own heartbeat isn't another tab's.
    expect(tourRunningElsewhere('u1')).toBe(false);
    await userEvent.click(within(first).getByRole('button', { name: 'Skip tour' }));
    await waitFor(() => expect(localStorage.getItem('tour-running')).toBeNull());
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

describe('tour heartbeat', () => {
  it('counts another tab’s fresh heartbeat for the same account only', () => {
    const now = 1_000_000;
    const other = (userId: string, at: number) =>
      localStorage.setItem('tour-running', JSON.stringify({ userId, tab: 'other-tab', at }));
    other('u1', now - 1000);
    expect(tourRunningElsewhere('u1', now)).toBe(true);
    expect(tourRunningElsewhere('u2', now)).toBe(false);
    other('u1', now - TOUR_BEAT_FRESH_MS);
    expect(tourRunningElsewhere('u1', now)).toBe(false);
    localStorage.setItem('tour-running', 'not json');
    expect(tourRunningElsewhere('u1', now)).toBe(false);
    markTourRunning('u1', now);
    expect(tourRunningElsewhere('u1', now)).toBe(false);
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
