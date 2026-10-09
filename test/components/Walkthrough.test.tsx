// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, showToast, track, nav } = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
  track: vi.fn(),
  nav: { pathname: '/' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => nav.pathname,
}));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/analytics', () => ({ track }));

import Walkthrough, { resetWalkthroughForTests, TOUR_AGAIN_TOAST } from '@/components/Walkthrough';
import TourSetting from '@/components/TourSetting';
import type { WalkthroughStatus } from '@/lib/utils/walkthrough';

const fetchMock = vi.fn();

/** `GET /api/users/me` answers this walkthrough status; every PATCH succeeds. */
function answer(status: WalkthroughStatus) {
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

/** A centred card: the step's dialog, found once its target search gives up. */
const step = (name: string) => screen.findByRole('dialog', { name }, { timeout: 2000 });

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
  vi.unstubAllGlobals();
  // @ts-expect-error jsdom has none of its own
  delete window.matchMedia;
});

/** Each step a phone shows, in order (no bookmarklet). */
const PHONE_STEPS = [
  'Lists for every occasion',
  'Adding items',
  'Sharing',
  'The surprise stays a surprise',
  'Reserved and No spoiler mode',
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

describe('Walkthrough', () => {
  it('shows a fresh account with no list the same tour, as a centred card where a target is missing', async () => {
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    const card = await step('Lists for every occasion');
    expect(card).toHaveAttribute('aria-modal', 'true');
    expect(card).toHaveTextContent('1 of 5');
    // Its made-up picture, decorative only.
    expect(card).toHaveTextContent('Maya’s birthday');
    expect(track).toHaveBeenCalledWith('tour_started', { source: 'auto' });
  });

  it('points at the target when the page has it', async () => {
    const target = addTarget('new-list');
    try {
      answer({ due: 'tour', ownsList: true });
      render(<Walkthrough userId="u1" />);
      const popover = await step('Lists for every occasion');
      expect(popover).not.toHaveAttribute('aria-modal');
      expect(target.scrollIntoView).toHaveBeenCalled();
      // Focus on Next, so Enter goes on rather than skipping.
      expect(within(popover).getByRole('button', { name: 'Next' })).toHaveFocus();
    } finally {
      target.remove();
    }
  });

  // regression: the popover listened for Escape on the whole document, so
  // Escape closing a dialog opened from the highlighted control skipped the tour.
  it('leaves Escape pressed outside the popover to whatever has focus', async () => {
    const target = addTarget('new-list');
    try {
      answer({ due: 'tour', ownsList: true });
      render(<Walkthrough userId="u1" />);
      const popover = await step('Lists for every occasion');
      act(() => target.focus());
      await userEvent.keyboard('{Escape}');
      expect(popover).toBeInTheDocument();
      expect(sent()).toEqual([]);
    } finally {
      target.remove();
    }
  });

  it('reads again on the next page after a failed read', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    const { rerender } = render(<Walkthrough userId="u1" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    answer({ due: 'tour', ownsList: false });
    nav.pathname = '/booked';
    rerender(<Walkthrough userId="u1" />);
    expect(await step('Lists for every occasion')).toBeInTheDocument();
  });

  it('skipping says where to find it again and records it', async () => {
    answer({ due: 'tour', ownsList: true });
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

  it('Escape skips', async () => {
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    await step('Lists for every occasion');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(sent()).toEqual(['skipped']));
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
  });

  it('Back goes a step back', async () => {
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    await nextThrough(['Lists for every occasion']);
    await userEvent.click(within(await step('Adding items')).getByRole('button', { name: 'Back' }));
    expect(await step('Lists for every occasion')).toBeInTheDocument();
  });

  it('ends on the closing card, whose Done or close finishes it', async () => {
    answer({ due: 'tour', ownsList: true });
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
    nav.pathname = '/booked';
    answer({ due: 'tour', ownsList: false });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS);
    await userEvent.click(
      within(await step('That’s it')).getByRole('button', { name: 'Create a list' })
    );
    expect(push).toHaveBeenCalledWith('/?newList=new');
    await waitFor(() => expect(sent()).toEqual(['completed']));
  });

  it('leaves out the bookmarklet step on a phone', async () => {
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS);
    expect(await step('That’s it')).toBeInTheDocument();
  });

  it('includes it on a desktop, linking to its Settings card', async () => {
    device(true);
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    expect(await step('Lists for every occasion')).toHaveTextContent('1 of 6');
    await nextThrough(PHONE_STEPS);
    const bookmarklet = await step('Add from any store');
    expect(within(bookmarklet).getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings#bookmarklet'
    );
  });

  it('shows the owner and friend views side by side, the owner’s with no reservation', async () => {
    answer({ due: 'tour', ownsList: true });
    render(<Walkthrough userId="u1" />);
    await nextThrough(PHONE_STEPS.slice(0, 3));
    const card = await step('The surprise stays a surprise');
    expect(card).toHaveTextContent('Maya sees');
    expect(card).toHaveTextContent('Friends see');
    expect(card).toHaveTextContent('Group gift · 40% funded');
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
