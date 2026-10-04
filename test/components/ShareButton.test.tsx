// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShareButton, { type ShareOwnerInfo } from '@/components/ShareButton';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

const share = vi.fn();
const onInvite = vi.fn();

/** A phone (`pointer: coarse`) or a desktop, with or without the Web Share API. */
function device({ touch, webShare }: { touch: boolean; webShare: boolean }) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(pointer: coarse)' && touch,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
  if (webShare) {
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
  }
}

const LIST_URL = () => `${window.location.origin}/wishlists/birthday`;

beforeEach(() => {
  showToast.mockReset();
  share.mockReset();
  share.mockResolvedValue(undefined);
  onInvite.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // jsdom has no navigator.share of its own.
  delete (navigator as { share?: unknown }).share;
});

function renderPlain(props: { url?: string } = { url: '/wishlists/birthday' }) {
  const user = userEvent.setup();
  render(<ShareButton {...props} title="Birthday" />);
  return user;
}

function renderOwner(owner: Partial<ShareOwnerInfo> = {}) {
  const user = userEvent.setup();
  render(
    <ShareButton
      url="/wishlists/birthday"
      title="Birthday"
      owner={{ visibility: 'everyone', onInvite, ...owner }}
    />
  );
  return user;
}

const shareButton = () => screen.getByRole('button', { name: 'Share' });

describe('ShareButton — the plain share (members, visitors, profiles)', () => {
  it('opens the share sheet on a touch device that has one, with the canonical link and the title', async () => {
    device({ touch: true, webShare: true });
    const user = renderPlain();
    await user.click(shareButton());

    expect(share).toHaveBeenCalledWith({ url: LIST_URL(), title: 'Birthday' });
    // The sheet is its own confirmation: nothing copied, no toast.
    expect(await navigator.clipboard.readText()).toBe('');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('copies the link on a touch device without the Web Share API', async () => {
    device({ touch: true, webShare: false });
    const user = renderPlain();
    await user.click(shareButton());

    expect(await navigator.clipboard.readText()).toBe(LIST_URL());
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('copies the link on a desktop, even one whose browser has navigator.share', async () => {
    device({ touch: false, webShare: true });
    const user = renderPlain();
    await user.click(shareButton());

    expect(share).not.toHaveBeenCalled();
    expect(await navigator.clipboard.readText()).toBe(LIST_URL());
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');
  });

  it('says nothing when the share sheet is cancelled (AbortError): no toast, nothing copied', async () => {
    device({ touch: true, webShare: true });
    share.mockRejectedValue(new DOMException('Share canceled', 'AbortError'));
    const user = renderPlain();
    await user.click(shareButton());

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();
    expect(await navigator.clipboard.readText()).toBe('');
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('copies the link instead when the share sheet fails for another reason', async () => {
    device({ touch: true, webShare: true });
    share.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    const user = renderPlain();
    await user.click(shareButton());

    expect(await navigator.clipboard.readText()).toBe(LIST_URL());
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');
  });

  it('says so when the link could not be copied', async () => {
    device({ touch: false, webShare: false });
    const user = renderPlain();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    await user.click(shareButton());

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Could not copy the link', 'error'));
  });

  it('says the link could not be shared when the sheet fails and the copy after it does too', async () => {
    device({ touch: true, webShare: true });
    share.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    const user = renderPlain();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('no activation'));
    await user.click(shareButton());

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not share the link', 'error')
    );
  });

  it("shares the current page's URL when given none", async () => {
    device({ touch: false, webShare: false });
    const user = renderPlain({});
    await user.click(shareButton());
    expect(await navigator.clipboard.readText()).toBe(window.location.href);
  });

  it('gives a non-owner no popover', async () => {
    device({ touch: false, webShare: false });
    const user = renderPlain();
    expect(shareButton()).not.toHaveAttribute('aria-haspopup');
    await user.click(shareButton());
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByText(/can open it|can view/)).toBeNull();
  });
});

describe('ShareButton — the owner popover', () => {
  // The text has to match getWishlistViewAccess (test/api/shareLinkAudience.test.ts).
  it.each([
    [{ visibility: 'everyone' }, 'Anyone with the link can view.'],
    [{ visibility: 'friends' }, 'Only friends of the owners, and people on the list, can open it.'],
    [{ visibility: 'private' }, 'Only people on the list can open it.'],
    [
      { visibility: 'everyone', archived: true },
      "Archived: the link won't open for anyone but the owners.",
    ],
    [
      { visibility: 'private', archived: true },
      "Archived: the link won't open for anyone but the owners.",
    ],
  ] as const)('tells the owner who the link opens for: %o', async (owner, text) => {
    device({ touch: false, webShare: false });
    const user = renderOwner(owner);
    expect(shareButton()).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(shareButton());

    expect(screen.getByText(text)).toBeVisible();
    // Read out when focus moves into the popover.
    expect(screen.getByRole('menu')).toHaveAccessibleDescription(text);
    // Opening it shares nothing yet.
    expect(share).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('offers Copy link, and no Share on a desktop', async () => {
    device({ touch: false, webShare: true });
    const user = renderOwner();
    await user.click(shareButton());

    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Copy link',
      'Invite people to reserve gifts',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(LIST_URL());
    expect(showToast).toHaveBeenCalledWith('Link copied to clipboard', 'success');
    expect(share).not.toHaveBeenCalled();
  });

  it('adds Share on a touch device, which opens the share sheet; Copy link still copies', async () => {
    device({ touch: true, webShare: true });
    const user = renderOwner({ visibility: 'friends' });
    await user.click(shareButton());

    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual([
      'Copy link',
      'Share',
      'Invite people to reserve gifts',
    ]);
    await user.click(screen.getByRole('menuitem', { name: 'Share' }));
    expect(share).toHaveBeenCalledWith({ url: LIST_URL(), title: 'Birthday' });
    expect(showToast).not.toHaveBeenCalled();

    await user.click(shareButton());
    await user.click(screen.getByRole('menuitem', { name: 'Copy link' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(await navigator.clipboard.readText()).toBe(LIST_URL());
  });

  it('says nothing when the owner cancels the share sheet', async () => {
    device({ touch: true, webShare: true });
    share.mockRejectedValue(new DOMException('Share canceled', 'AbortError'));
    const user = renderOwner();
    await user.click(shareButton());
    await user.click(screen.getByRole('menuitem', { name: 'Share' }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(showToast).not.toHaveBeenCalled();
  });

  // The page's onInvite opens People, where the invite form is (see
  // WishlistEmptyState.test.tsx).
  it('takes the owner to invite people, to let them reserve gifts', async () => {
    device({ touch: false, webShare: false });
    const user = renderOwner({ visibility: 'private' });
    await user.click(shareButton());
    await user.click(screen.getByRole('menuitem', { name: 'Invite people to reserve gifts' }));

    expect(onInvite).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(share).not.toHaveBeenCalled();
    expect(await navigator.clipboard.readText()).toBe('');
  });
});
