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

describe('Walkthrough', () => {
  it('shows a fresh account the member tour, as a centred card where its target is missing', async () => {
    answer({ due: 'tour', variant: 'member' });
    render(<Walkthrough userId="u1" />);
    const card = await step('This list');
    expect(card).toHaveAttribute('aria-modal', 'true');
    expect(card).toHaveTextContent('1 of 4');
    expect(track).toHaveBeenCalledWith('tour_started', { variant: 'member', source: 'auto' });
  });

  it('points at the target when the page has it', async () => {
    const grid = document.createElement('div');
    grid.dataset.tour = 'items';
    grid.getBoundingClientRect = () => ({ top: 100, left: 20, width: 300, height: 200 }) as DOMRect;
    grid.scrollIntoView = vi.fn();
    document.body.appendChild(grid);
    try {
      answer({ due: 'tour', variant: 'member' });
      render(<Walkthrough userId="u1" />);
      const popover = await step('This list');
      expect(popover).not.toHaveAttribute('aria-modal');
      expect(grid.scrollIntoView).toHaveBeenCalled();
      // Focus on Next, so Enter goes on rather than skipping.
      expect(within(popover).getByRole('button', { name: 'Next' })).toHaveFocus();
    } finally {
      grid.remove();
    }
  });

  // regression: the popover listened for Escape on the whole document, so
  // Escape closing a dialog opened from the highlighted control skipped the tour.
  it('leaves Escape pressed outside the popover to whatever has focus', async () => {
    const target = document.createElement('button');
    target.dataset.tour = 'items';
    target.getBoundingClientRect = () =>
      ({ top: 100, left: 20, width: 300, height: 200 }) as DOMRect;
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    try {
      answer({ due: 'tour', variant: 'member' });
      render(<Walkthrough userId="u1" />);
      const popover = await step('This list');
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
    answer({ due: 'tour', variant: 'member' });
    nav.pathname = '/booked';
    rerender(<Walkthrough userId="u1" />);
    expect(await step('This list')).toBeInTheDocument();
  });

  it('skipping says where to find it again and records it', async () => {
    answer({ due: 'tour', variant: 'member' });
    render(<Walkthrough userId="u1" />);
    const card = await step('This list');
    await userEvent.click(within(card).getByRole('button', { name: 'Skip tour' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', {
      action: { label: 'Open Settings', href: '/settings#tour' },
    });
    await waitFor(() => expect(sent()).toEqual(['skipped']));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('tour_skipped', { variant: 'member', step: 'list' })
    );
  });

  it('Escape skips', async () => {
    answer({ due: 'tour', variant: 'member' });
    render(<Walkthrough userId="u1" />);
    await step('This list');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(sent()).toEqual(['skipped']));
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
  });

  it('finishing the member tour says where to find it again', async () => {
    answer({ due: 'tour', variant: 'member' });
    render(<Walkthrough userId="u1" />);
    await userEvent.click(within(await step('This list')).getByRole('button', { name: 'Next' }));
    await userEvent.click(within(await step('Group gifts')).getByRole('button', { name: 'Next' }));
    await userEvent.click(
      within(await step('Reserved and No spoiler mode')).getByRole('button', { name: 'Next' })
    );
    const last = await step('Your own list');
    expect(last).toHaveTextContent('4 of 4');
    await userEvent.click(within(last).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
    await waitFor(() => expect(sent()).toEqual(['completed']));
    await waitFor(() => expect(track).toHaveBeenCalledWith('tour_finished', { variant: 'member' }));
  });

  it('the member tour’s Create a list finishes it and opens New list', async () => {
    nav.pathname = '/booked';
    answer({ due: 'tour', variant: 'member' });
    render(<Walkthrough userId="u1" />);
    for (const name of ['This list', 'Group gifts', 'Reserved and No spoiler mode']) {
      await userEvent.click(within(await step(name)).getByRole('button', { name: 'Next' }));
    }
    await userEvent.click(
      within(await step('Your own list')).getByRole('button', { name: 'Create a list' })
    );
    expect(push).toHaveBeenCalledWith('/?newList=new');
    await waitFor(() => expect(sent()).toEqual(['completed']));
  });

  it('leaves out the bookmarklet step on a phone', async () => {
    answer({ due: 'tour', variant: 'owner' });
    render(<Walkthrough userId="u1" />);
    const first = await step('Your lists');
    expect(first).toHaveTextContent('1 of 5');
    await userEvent.click(within(first).getByRole('button', { name: 'Next' }));
    await userEvent.click(within(await step('Adding items')).getByRole('button', { name: 'Next' }));
    expect(await step('Sharing')).toBeInTheDocument();
  });

  it('includes it on a desktop, linking to its Settings card', async () => {
    device(true);
    answer({ due: 'tour', variant: 'owner' });
    render(<Walkthrough userId="u1" />);
    const first = await step('Your lists');
    expect(first).toHaveTextContent('1 of 6');
    await userEvent.click(within(first).getByRole('button', { name: 'Next' }));
    await userEvent.click(within(await step('Adding items')).getByRole('button', { name: 'Next' }));
    const bookmarklet = await step('Add from any store');
    expect(within(bookmarklet).getByRole('link', { name: 'Open Settings' })).toHaveAttribute(
      'href',
      '/settings#bookmarklet'
    );
  });

  it('ends the owner tour on the closing card, whose close finishes it', async () => {
    answer({ due: 'tour', variant: 'owner' });
    render(<Walkthrough userId="u1" />);
    for (const name of [
      'Your lists',
      'Adding items',
      'Sharing',
      'The surprise stays a surprise',
      'Reserved and No spoiler mode',
    ]) {
      await userEvent.click(within(await step(name)).getByRole('button', { name: 'Next' }));
    }
    const closing = await step('That’s it');
    expect(closing).toHaveTextContent('Coming up shows friends’ birthdays and occasions.');
    expect(within(closing).queryByRole('button', { name: 'Skip tour' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(sent()).toEqual(['completed']));
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
  });

  it('offers the tour after time away; dismissing it says where to find it', async () => {
    answer({ due: 'offer', variant: 'owner' });
    render(<Walkthrough userId="u1" />);
    const offer = await step('Want a quick look around?');
    await userEvent.click(within(offer).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(showToast).toHaveBeenCalledWith(TOUR_AGAIN_TOAST, 'info', expect.anything());
    await waitFor(() => expect(sent()).toEqual(['offer_dismissed']));
    await waitFor(() =>
      expect(track).toHaveBeenCalledWith('tour_offer_dismissed', { variant: 'owner' })
    );
  });

  it('accepting the offer starts the tour', async () => {
    answer({ due: 'offer', variant: 'owner' });
    render(<Walkthrough userId="u1" />);
    const offer = await step('Want a quick look around?');
    await userEvent.click(within(offer).getByRole('button', { name: 'Take the tour' }));
    expect(await step('Your lists')).toBeInTheDocument();
    await waitFor(() => expect(sent()).toEqual(['offer_accepted']));
    expect(track).toHaveBeenCalledWith('tour_started', { variant: 'owner', source: 'offer' });
  });

  it('shows nothing when nothing is due, and reads once per tab', async () => {
    answer({ due: null, variant: 'owner' });
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
    answer({ due: 'tour', variant: 'owner' });
    render(<Walkthrough userId="u1" />);
    expect(await step('Your lists')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(track).toHaveBeenCalledWith('tour_started', { variant: 'owner', source: 'settings' });
  });

  it('never runs on the bookmarklet page, nor over a list just joined', async () => {
    answer({ due: 'tour', variant: 'member' });
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
    answer({ due: 'tour', variant: 'owner' });
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
