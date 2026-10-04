// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import MemberWelcome from '@/components/MemberWelcome';
import {
  hasWelcomeMarker,
  memberWelcomeText,
  welcomeDismissedKey,
  withWelcomeMarker,
} from '@/lib/utils/memberWelcome';

function renderWelcome(over: Partial<Parameters<typeof MemberWelcome>[0]> = {}) {
  return render(
    <MemberWelcome
      wishlistId="w1"
      userId="u1"
      isMember
      isOwner={false}
      ownerUsernames={['ben_carter']}
      ownerCount={1}
      {...over}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/wishlists/birthday?welcome=1');
});
afterEach(cleanup);

describe('MemberWelcome', () => {
  it('shows to a member who followed the accept link, naming the single owner', () => {
    renderWelcome();
    expect(screen.getByRole('note').textContent).toContain(
      "You're in. Reserve a gift so nobody else buys it. @ben_carter won't see who reserved what."
    );
  });

  it('says "the owners" with several owners', () => {
    renderWelcome({ ownerUsernames: ['a', 'b'], ownerCount: 2 });
    expect(screen.getByRole('note').textContent).toContain("the owners won't see");
  });

  it('shows nothing to an owner', () => {
    renderWelcome({ isOwner: true, isMember: false });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows nothing to a non-member who has the marker, and still clears it', () => {
    renderWelcome({ isMember: false });
    expect(screen.queryByRole('note')).toBeNull();
    expect(window.location.search).toBe('');
  });

  it('shows nothing without the marker', () => {
    window.history.replaceState(null, '', '/wishlists/birthday');
    renderWelcome();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('clears only the marker from the URL', () => {
    window.history.replaceState(null, '', '/wishlists/birthday?show=available&welcome=1&tab=x');
    renderWelcome();
    expect(window.location.search).toBe('?show=available&tab=x');
  });

  it('Got it hides it for good for that user and list', () => {
    const { unmount } = renderWelcome();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(window.localStorage.getItem(welcomeDismissedKey('u1', 'w1'))).not.toBeNull();
    unmount();

    // A reload that arrives with the marker again stays hidden.
    window.history.replaceState(null, '', '/wishlists/birthday?welcome=1');
    renderWelcome();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is not hidden by another list or user dismissing theirs', () => {
    window.localStorage.setItem(welcomeDismissedKey('u1', 'w2'), '1');
    renderWelcome();
    expect(screen.getByRole('note')).toBeTruthy();
  });
});

describe('welcome marker helpers', () => {
  it('adds and reads the marker', () => {
    expect(withWelcomeMarker('/wishlists/a')).toBe('/wishlists/a?welcome=1');
    expect(hasWelcomeMarker('?welcome=1')).toBe(true);
    expect(hasWelcomeMarker('?welcome=0')).toBe(false);
    expect(memberWelcomeText([], 1)).toContain('the owners');
  });
});
