// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import FollowListModal, { FOLLOW_SEARCH_MIN } from '@/components/FollowListModal';

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
/** One of the two lists, a radio in the dialog's segmented control. */
const tab = (name: string) => screen.getByRole('radio', { name });

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

    // The two lists are one stop: the selected one (the arrow keys move between them).
    await user.tab();
    expect(tab('2 followers')).toHaveFocus();
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

    expect(tab('1 follower')).toBeInTheDocument();
    expect(tab('1 following')).toBeInTheDocument();
  });
});

type User = ReturnType<typeof userEvent.setup>;

describe('FollowListModal — a list that couldn’t be loaded', () => {
  const failures: [string, () => Promise<unknown>][] = [
    [
      'a 5xx',
      async () => ({ json: async () => ({ success: false, error: 'Failed to fetch followers' }) }),
    ],
    [
      'a network error',
      async () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ];

  // regression: a failed read showed "No followers yet", which claims there
  // are none, with nothing to say it had failed.
  it.each(failures)(
    'regression: says so in its place after %s, with Try again, which reads it afresh',
    async (_label, fail) => {
      const followers = vi.mocked(fetch).getMockImplementation()!;
      vi.mocked(fetch).mockImplementation(fail as typeof fetch);
      const user = userEvent.setup();
      render(<ProfilePage />);
      await user.click(button('Show followers'));

      await screen.findByRole('heading', { name: 'Couldn’t load followers' });
      expect(screen.queryByRole('heading', { name: 'No followers yet' })).toBeNull();

      vi.mocked(fetch).mockImplementation(followers);
      await user.click(button('Try again'));
      expect(await screen.findByRole('link', { name: '@bob' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Couldn’t load followers' })).toBeNull();
      // Its button went away while the list was read, and focus stayed in the dialog.
      expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    }
  );

  it('reads a tab whose list failed again when it’s opened again', async () => {
    const followers = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(failures[1][1] as typeof fetch);
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.click(button('Show followers'));
    await screen.findByRole('heading', { name: 'Couldn’t load followers' });

    await user.click(tab('0 following'));
    expect(
      await screen.findByRole('heading', { name: 'Couldn’t load following' })
    ).toBeInTheDocument();

    vi.mocked(fetch).mockImplementation(followers);
    await user.click(tab('2 followers'));
    expect(await screen.findByRole('link', { name: '@bob' })).toBeInTheDocument();
  });
});

describe('FollowListModal — searching a list (WIS-426)', () => {
  type Person = { _id: string; username: string; image: null };
  const people = (names: string[]): Person[] =>
    names.map((username, i) => ({ _id: `p${i}`, username, image: null }));
  const FOLLOWERS = people(['alice', 'albert', 'bob', 'carol', 'dave', 'erin']);
  const FOLLOWING = people(['zed', 'yara', 'xavi', 'walt', 'vera', 'alina']);

  /** Each tab answers its own list. */
  function serve(following: Person[]) {
    vi.mocked(fetch).mockImplementation((async (url: string) => ({
      json: async () => ({
        success: true,
        data: String(url).endsWith('/following') ? following : FOLLOWERS,
      }),
    })) as unknown as typeof fetch);
  }

  async function open(following = FOLLOWING, { counts = true } = {}) {
    serve(following);
    const user = userEvent.setup();
    render(
      <FollowListModal
        userId="u1"
        initialTab="followers"
        followerCount={counts ? FOLLOWERS.length : undefined}
        followingCount={counts ? following.length : undefined}
        onClose={() => {}}
      />
    );
    await screen.findByRole('link', { name: '@bob' });
    return user;
  }
  const search = (name: string) => screen.getByRole('textbox', { name });
  const names = () =>
    screen.queryAllByRole('link').map((a) => '@' + a.getAttribute('href')!.split('/').pop());

  it('filters the loaded rows by username, as the global search reads a handle', async () => {
    const user = await open();
    expect(FOLLOWERS.length).toBeGreaterThanOrEqual(FOLLOW_SEARCH_MIN);

    await user.type(search('Search followers'), '@AL');
    expect(names()).toEqual(['@alice', '@albert']);
    expect(screen.getByRole('status')).toHaveTextContent('2 matches');

    // A space after the @ is no part of the handle (`usernameQuery`).
    await user.clear(search('Search followers'));
    await user.type(search('Search followers'), '@ car');
    expect(names()).toEqual(['@carol']);

    // A lone @ searches for nothing: everyone stays.
    await user.clear(search('Search followers'));
    await user.type(search('Search followers'), '@');
    expect(names()).toHaveLength(FOLLOWERS.length);

    // Typing only filters what's here: no request per keystroke.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('says no one matches, not that the list is empty, and Clear brings everyone back', async () => {
    const user = await open();

    await user.type(search('Search followers'), 'nobody');
    expect(names()).toEqual([]);
    expect(screen.getByRole('heading', { name: 'No one matches' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No followers yet' })).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('0 matches');

    await user.click(button('Clear search'));
    expect(names()).toHaveLength(FOLLOWERS.length);
    expect(search('Search followers')).toHaveFocus();
  });

  it('keeps a query per tab', async () => {
    const user = await open();
    await user.type(search('Search followers'), 'ali');
    expect(names()).toEqual(['@alice']);

    await user.click(tab(`${FOLLOWING.length} following`));
    await screen.findByRole('link', { name: '@zed' });
    expect(search('Search following')).toHaveValue('');
    expect(names()).toHaveLength(FOLLOWING.length);

    await user.click(tab(`${FOLLOWERS.length} followers`));
    expect(search('Search followers')).toHaveValue('ali');
    expect(names()).toEqual(['@alice']);
  });

  it('offers no search on a short list', async () => {
    const user = await open(people(['zed', 'yara']));
    await user.click(tab('2 following'));
    await screen.findByRole('link', { name: '@zed' });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(names()).toEqual(['@zed', '@yara']);
  });

  // The field goes by the tab's count, so it's there before the rows arrive
  // and the header doesn't move when they do.
  it('shows the field while a long list loads', async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    render(
      <FollowListModal
        userId="u1"
        initialTab="followers"
        followerCount={40}
        followingCount={0}
        onClose={() => {}}
      />
    );

    expect(search('Search followers')).toBeInTheDocument();
  });

  it('goes by the rows read when the opener has no counts (Activity)', async () => {
    const user = await open(people(['zed']), { counts: false });
    expect(search('Search followers')).toBeInTheDocument();

    await user.click(tab('Following'));
    await screen.findByRole('link', { name: '@zed' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('offers no search in place of a list that couldn’t be loaded', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    render(
      <FollowListModal
        userId="u1"
        initialTab="followers"
        followerCount={40}
        followingCount={0}
        onClose={() => {}}
      />
    );

    await screen.findByRole('heading', { name: 'Couldn’t load followers' });
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
