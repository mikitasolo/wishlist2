// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import FollowListModal from '@/components/FollowListModal';

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => {
  cleanup();
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({
        success: true,
        data: [
          { _id: 'u2', username: 'alice', image: null },
          { _id: 'u3', username: 'bob', image: null },
        ],
      }),
    })
  );
  return () => vi.unstubAllGlobals();
});
// Fail on anything logged: a React warning, or an error while moving focus.
beforeEach(() => {
  const consoleError = vi.spyOn(console, 'error');
  return () => {
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  };
});

/** A profile header: the follower count opens the modal, as on the real page. */
function ProfilePage() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Show followers</button>
      <button>Behind</button>
      {open && (
        <FollowListModal
          userId="u1"
          initialTab="followers"
          followerCount={2}
          followingCount={0}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const button = (name: string) => screen.getByRole('button', { name });
const link = (name: string) => screen.getByRole('link', { name });

async function openModal({ strict = false } = {}) {
  const user = userEvent.setup();
  render(
    strict ? (
      <StrictMode>
        <ProfilePage />
      </StrictMode>
    ) : (
      <ProfilePage />
    )
  );
  await user.click(button('Show followers'));
  // The list loads in.
  await screen.findByRole('link', { name: '@bob' });
  return user;
}

describe('FollowListModal — keyboard focus', () => {
  // regression: the modal had no focus management, so focus stayed on the
  // count behind its backdrop.
  it('regression: moves focus into it when it opens', async () => {
    await openModal();

    expect(button('Close')).toHaveFocus();
  });

  // Focus moving in has a screen reader announce the dialog, by its title.
  it('is named by its title', async () => {
    await openModal();

    expect(screen.getByRole('dialog', { name: 'Connections' })).toBeInTheDocument();
  });

  // StrictMode (on in `next dev`) runs the effects of a modal that mounts open twice.
  it('moves focus into it under StrictMode too', async () => {
    await openModal({ strict: true });

    expect(button('Close')).toHaveFocus();
  });

  // regression: Tab and Shift+Tab walked out of it to the page behind.
  it('regression: keeps Tab and Shift+Tab inside, wrapping at both ends', async () => {
    const user = await openModal();

    await user.tab();
    expect(button('2 followers')).toHaveFocus();
    await user.tab();
    expect(button('0 following')).toHaveFocus();
    await user.tab();
    expect(link('@alice')).toHaveFocus();
    await user.tab();
    expect(link('@bob')).toHaveFocus();
    await user.tab();
    expect(button('Close')).toHaveFocus();
    await user.tab({ shift: true });
    expect(link('@bob')).toHaveFocus();
  });

  // regression: closing it left focus on <body>, not on the count that opened it.
  it.each([
    { how: 'Escape', close: (user: User) => user.keyboard('{Escape}') },
    { how: 'the close button', close: (user: User) => user.click(button('Close')) },
    {
      how: 'a backdrop click',
      close: (user: User) => user.click(screen.getByRole('dialog').parentElement!),
    },
  ])(
    'regression: returns focus to the count that opened it when closed with $how',
    async ({ close }) => {
      const user = await openModal();
      expect(button('Close')).toHaveFocus();

      await close(user);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(button('Show followers')).toHaveFocus();
    }
  );
});

describe('FollowListModal — its tabs', () => {
  // regression: the tabs read "1 followers": each wrote a plural noun after its
  // count, whatever the count.
  it('regression: agrees each count with its noun', async () => {
    render(
      <FollowListModal
        userId="u1"
        initialTab="followers"
        followerCount={1}
        followingCount={1}
        onClose={() => {}}
      />
    );
    await screen.findByRole('link', { name: '@bob' });

    expect(button('1 follower')).toBeInTheDocument();
    expect(button('1 following')).toBeInTheDocument();
  });
});

type User = ReturnType<typeof userEvent.setup>;
