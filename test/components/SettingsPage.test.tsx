// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { atWidth } from './viewport';

const { push, showToast, update, upload, auth, signOut, setTheme } = vi.hoisted(() => {
  // The session's status, which the page reloads the profile on: next-auth's
  // `update()` turns it to `loading` and back.
  let status = 'authenticated';
  const listeners = new Set<() => void>();
  return {
    push: vi.fn(),
    showToast: vi.fn(),
    update: vi.fn(),
    signOut: vi.fn(),
    setTheme: vi.fn(),
    // What the photo control's upload hands back when it finishes.
    upload: { url: '' },
    auth: {
      status: () => status,
      set(next: string) {
        status = next;
        listeners.forEach((listener) => listener());
      },
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
});

vi.mock('next-auth/react', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useSession: () => ({
      data: { user: { id: 'me', username: 'alice' } },
      status: useSyncExternalStore(auth.subscribe, auth.status),
      update,
    }),
    signOut,
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
// The header has its own fetches and tests; this file is about the settings form.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/components/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light', setTheme }) }));
// An upload that finishes, and Remove: the real control crops and posts the
// file first. It ignores `disabled`, like an upload that finishes while a save
// is in flight.
vi.mock('@/components/ImageUpload', () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (url: string | null) => void;
  }) => (
    <div data-testid="photo" data-value={value ?? ''}>
      <button type="button" onClick={() => onChange(upload.url)}>
        Finish upload
      </button>
      <button type="button" onClick={() => onChange(null)}>
        Remove photo
      </button>
    </div>
  ),
}));

import SettingsPage from '@/app/settings/page';

const PHOTO = 'https://store.public.blob.vercel-storage.com/uploads/me/new.webp';
const OLD_PHOTO = 'https://store.public.blob.vercel-storage.com/uploads/me/old.webp';

type Privacy = { searchable: boolean; whoCanInvite: string; profileVisibility: string };
type Profile = {
  _id: string;
  email: string;
  username: string;
  image: string | null;
  bio: string | null;
  defaultCurrency: string;
  privacy: Privacy;
};

const reply = (body: unknown, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

/** The profile as the server has it: another tab's saves land here. */
let server: Profile;
/** The bodies of the PATCHes the page sent, in order. */
let patches: Record<string, unknown>[];
/** Set to hold the next PATCH's answer until the test lets it go. */
let holdPatch: Promise<void> | null;
/** Set to hold the next PATCH's answer, once it has been written, until the test lets it go. */
let holdReply: Promise<void> | null;
/** Set to make the next PATCH fail. */
let failPatch: string | boolean;
/** Set to hold the next GET's answer (read when it's sent) until the test lets it go. */
let holdGet: Promise<void> | null;
/** How many GETs of the profile the page has sent. */
let gets: number;
/** Set to make every GET fail: the route answering 500, or the network. */
let failGet: 'server' | 'network' | null;

const fetchMock = vi.fn();

beforeEach(() => {
  push.mockReset();
  showToast.mockReset();
  update.mockReset();
  update.mockResolvedValue(undefined);
  signOut.mockReset();
  setTheme.mockReset();
  fetchMock.mockReset();
  upload.url = PHOTO;
  patches = [];
  holdPatch = null;
  holdReply = null;
  failPatch = false;
  holdGet = null;
  gets = 0;
  failGet = null;
  auth.set('authenticated');
  server = {
    _id: 'me',
    email: 'alice@example.com',
    username: 'alice',
    image: OLD_PHOTO,
    bio: 'I collect mugs.',
    defaultCurrency: 'EUR',
    privacy: { searchable: true, whoCanInvite: 'everyone', profileVisibility: 'everyone' },
  };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/users/me' && method === 'GET') {
      gets += 1;
      if (failGet === 'network') throw new TypeError('Failed to fetch');
      if (failGet === 'server')
        return reply({ success: false, error: 'Failed to fetch user' }, 500);
      // Read now, answered once let go: a save can land in between.
      const read = { ...server, privacy: { ...server.privacy } };
      if (holdGet) await holdGet;
      return reply({ success: true, data: { ...read, followerCount: 0, followingCount: 0 } });
    }
    if (url === '/api/users/me' && method === 'PATCH') {
      const body = JSON.parse(String(init?.body));
      patches.push(body);
      const hold = holdPatch;
      holdPatch = null;
      if (hold) await hold;
      if (failPatch) {
        const error = typeof failPatch === 'string' ? failPatch : 'Failed to update profile';
        failPatch = false;
        return reply({ success: false, error }, 500);
      }
      // The route's one write: what it was sent, each privacy setting on its
      // own, over the profile as it is by then.
      const { privacy, ...rest } = body;
      if ('image' in rest) rest.image = rest.image || null;
      server = { ...server, ...rest, privacy: { ...server.privacy, ...privacy } };
      const answer = { ...server, privacy: { ...server.privacy } };
      const replyHold = holdReply;
      holdReply = null;
      if (replyHold) await replyHold;
      return reply({ success: true, data: answer });
    }
    if (url.startsWith('/api/users/check-username')) {
      return reply({ available: true });
    }
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  // A desktop's width, where the username and bio's Save sits in their panel.
  atWidth(1280);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function openSettings() {
  const user = userEvent.setup();
  render(<SettingsPage />);
  await screen.findByRole('switch', { name: 'Searchable' });
  return user;
}

const searchable = () => screen.getByRole('switch', { name: 'Searchable' });
const radio = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name });
const visibilityOption = (name: string) => radio('Who can see your profile', name);
const inviteOption = (name: string) => radio('Who can invite you to wishlists', name);
const photoValue = () => screen.getByTestId('photo').getAttribute('data-value');
const currencyPicker = () => screen.getByRole('combobox', { name: 'Default currency' });
const bio = () => screen.getByRole('textbox', { name: 'Bio' });
const saveText = () => screen.getByRole('button', { name: /^(save|saving…)$/i });

async function pickCurrency(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.click(currencyPicker());
  await user.click(screen.getByRole('option', { name: new RegExp(`^${code}\\b`) }));
}

/**
 * Each setting that saves as it's changed: how to change it, what it sends,
 * and how to read what the control shows (before and after).
 */
const instantControls = [
  {
    name: 'Searchable',
    change: async (user: ReturnType<typeof userEvent.setup>) => user.click(searchable()),
    sends: { privacy: { searchable: false } },
    shown: () => searchable().getAttribute('aria-checked'),
    before: 'true',
    after: 'false',
  },
  {
    name: 'Who can invite you',
    change: async (user: ReturnType<typeof userEvent.setup>) => user.click(inviteOption('No one')),
    sends: { privacy: { whoCanInvite: 'nobody' } },
    shown: () =>
      inviteOption('No one').getAttribute('aria-checked') === 'true' ? 'nobody' : 'everyone',
    before: 'everyone',
    after: 'nobody',
  },
  {
    name: 'Who can see your profile',
    change: async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(visibilityOption('Friends only')),
    sends: { privacy: { profileVisibility: 'friends' } },
    shown: () =>
      visibilityOption('Friends only').getAttribute('aria-checked') === 'true'
        ? 'friends'
        : 'everyone',
    before: 'everyone',
    after: 'friends',
  },
  {
    name: 'Default currency',
    change: async (user: ReturnType<typeof userEvent.setup>) => pickCurrency(user, 'PLN'),
    sends: { defaultCurrency: 'PLN' },
    shown: () => currencyPicker().textContent ?? '',
    before: expect.stringMatching(/EUR/),
    after: expect.stringMatching(/PLN/),
  },
  {
    name: 'Profile photo (a new one)',
    change: async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByRole('button', { name: 'Finish upload' })),
    sends: { image: PHOTO },
    shown: photoValue,
    before: OLD_PHOTO,
    after: PHOTO,
  },
  {
    name: 'Profile photo (removed)',
    change: async (user: ReturnType<typeof userEvent.setup>) =>
      user.click(screen.getByRole('button', { name: 'Remove photo' })),
    sends: { image: '' },
    shown: photoValue,
    before: OLD_PHOTO,
    after: '',
  },
];

describe('settings that save as they change', () => {
  it.each(instantControls)('$name sends only itself and says Saved', async (control) => {
    const user = await openSettings();
    // An edit of the bio, not saved yet, stays out of the instant save.
    await user.type(bio(), ' Unsaved.');

    await control.change(user);

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual(control.sends);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(control.shown()).toEqual(control.after);
    expect(bio()).toHaveValue('I collect mugs. Unsaved.');
    expect(showToast).not.toHaveBeenCalled();
  });

  it.each(instantControls)(
    '$name goes back to what’s saved when its save fails',
    async (control) => {
      const user = await openSettings();
      failPatch = true;

      await control.change(user);

      expect(await screen.findByText('Couldn’t save. Try again.')).toBeInTheDocument();
      expect(control.shown()).toEqual(control.before);
      expect(screen.queryByText('Saved')).toBeNull();
    }
  );

  it('takes "Saved" down after about two seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = await openSettings();

    await user.click(searchable());
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.queryByText('Saved')).toBeNull();
  });

  // regression: the page sent the whole `privacy` object with every save, as
  // the form loaded it, so changing "Searchable" here wrote back
  // `profileVisibility: everyone` over the friends-only another tab had saved.
  it('regression: a save of one privacy setting sends only it, leaving the visibility another tab set alone', async () => {
    const user = await openSettings();
    // Another tab makes the profile friends-only while this one is open.
    server.privacy = { ...server.privacy, profileVisibility: 'friends' };

    await user.click(searchable());

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ privacy: { searchable: false } });
    expect(server.privacy).toEqual({
      searchable: false,
      whoCanInvite: 'everyone',
      profileVisibility: 'friends',
    });
    // The form takes in the other tab's change from the answer.
    await waitFor(() =>
      expect(visibilityOption('Friends only')).toHaveAttribute('aria-checked', 'true')
    );

    // And the next change sends only itself again, so it can't put "Everyone" back.
    await user.click(inviteOption('Friends'));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ privacy: { whoCanInvite: 'friends' } });
    expect(server.privacy.profileVisibility).toBe('friends');
  });

  it('sends a setting changed again while its save is in flight once that save has landed', async () => {
    const user = await openSettings();
    let release!: () => void;
    holdPatch = new Promise((resolve) => (release = resolve));

    await user.click(searchable());
    await waitFor(() => expect(patches).toHaveLength(1));
    await user.click(searchable());
    // Not two saves of one setting in flight at once.
    expect(patches).toHaveLength(1);

    release();
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ privacy: { searchable: true } });
    await waitFor(() => expect(searchable()).toHaveAttribute('aria-checked', 'true'));
    expect(server.privacy.searchable).toBe(true);
  });

  // regression: saves of different settings run side by side, and an earlier
  // one's answer arriving last put its older profile in as saved: turning the
  // setting back then sent nothing, as it already read as saved that way.
  it('regression: an earlier save answered last can’t stop the next change from being sent', async () => {
    const user = await openSettings();
    let releaseA!: () => void;
    holdReply = new Promise((resolve) => (releaseA = resolve));

    // A is written, but answers after B.
    await user.click(searchable());
    await waitFor(() => expect(patches).toHaveLength(1));
    await user.click(inviteOption('Friends'));
    await waitFor(() => expect(patches).toHaveLength(2));
    await waitFor(() => expect(inviteOption('Friends')).toHaveAttribute('aria-checked', 'true'));
    await act(async () => {
      releaseA();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await waitFor(() => expect(screen.getAllByText('Saved')).toHaveLength(2));
    expect(inviteOption('Friends')).toHaveAttribute('aria-checked', 'true');

    // A's answer predates B's write, so it read "Everyone": picking that back
    // has to be sent all the same.
    await user.click(inviteOption('Everyone'));
    await waitFor(() => expect(patches).toHaveLength(3));
    expect(patches[2]).toEqual({ privacy: { whoCanInvite: 'everyone' } });
    await waitFor(() => expect(server.privacy.whoCanInvite).toBe('everyone'));
    expect(server.privacy.searchable).toBe(false);
  });

  it('reads the session again after a new photo or currency, so the header shows it', async () => {
    const user = await openSettings();

    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));

    await pickCurrency(user, 'PLN');
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));

    // A privacy setting isn't in the session.
    await user.click(searchable());
    await waitFor(() => expect(patches).toHaveLength(3));
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('reports a photo as saved when the session refresh after it fails', async () => {
    const user = await openSettings();
    update.mockRejectedValue(new Error('session down'));

    await user.click(screen.getByRole('button', { name: 'Finish upload' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(photoValue()).toBe(PHOTO);
  });

  it('drops a reload that read the profile before a later save landed', async () => {
    const user = await openSettings();
    // Like next-auth's: the status goes to loading and back, and the page
    // reads the profile again.
    update.mockImplementation(async () => {
      auth.set('loading');
      await Promise.resolve();
      auth.set('authenticated');
    });
    let release!: () => void;
    holdGet = new Promise((resolve) => (release = resolve));

    // A photo change refreshes the session, which sends the reload.
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await waitFor(() => expect(gets).toBe(2));

    // The reload has read the profile but not answered when the next save lands.
    await user.click(searchable());
    await waitFor(() => expect(patches).toHaveLength(2));
    await waitFor(() => expect(server.privacy.searchable).toBe(false));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Its answer predates that save, so the form keeps what the save stored.
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(searchable()).toHaveAttribute('aria-checked', 'false');
  });

  it('keeps the form up while the session is read again', async () => {
    const user = await openSettings();
    update.mockImplementation(async () => {
      auth.set('loading');
      await Promise.resolve();
    });
    await user.type(bio(), ' Still typing.');

    await pickCurrency(user, 'PLN');
    await waitFor(() => expect(update).toHaveBeenCalled());

    expect(bio()).toHaveValue('I collect mugs. Still typing.');
    act(() => auth.set('authenticated'));
  });

  it('changes the theme in place, with nothing sent', async () => {
    const user = await openSettings();
    await user.click(radio('Theme', 'Dark'));
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(patches).toHaveLength(0);
  });
});

describe('the username and bio', () => {
  it('wait for their own Save, which sends only them', async () => {
    const user = await openSettings();
    expect(saveText()).toBeDisabled();

    await user.clear(bio());
    await user.type(bio(), 'Mugs and plants.');
    expect(patches).toHaveLength(0);
    await user.click(saveText());

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ bio: 'Mugs and plants.' });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(saveText()).toBeDisabled();
  });

  it('sends a new username, and reads the session again', async () => {
    const user = await openSettings();
    const field = screen.getByLabelText('Username', { exact: true });
    await user.clear(field);
    await user.type(field, 'alice_two');
    await waitFor(() => expect(saveText()).toBeEnabled());

    await user.click(saveText());

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ username: 'alice_two' });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it('Cancel puts back what’s saved', async () => {
    const user = await openSettings();
    await user.type(bio(), ' Oops.');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(bio()).toHaveValue('I collect mugs.');
    expect(saveText()).toBeDisabled();
    expect(patches).toHaveLength(0);
  });

  it('keeps the edits when their save fails, and says why', async () => {
    const user = await openSettings();
    failPatch = 'That username is already taken.';
    await user.type(bio(), ' And plants.');

    await user.click(saveText());

    expect(await screen.findByText('That username is already taken.')).toBeInTheDocument();
    expect(bio()).toHaveValue('I collect mugs. And plants.');
    await user.click(saveText());
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual(patches[0]);
  });

  it('keeps a photo saved while the bio is being edited, and the bio edit', async () => {
    const user = await openSettings();
    await user.type(bio(), ' Plants.');
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await screen.findByText('Saved');

    await user.click(saveText());
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ bio: 'I collect mugs. Plants.' });
    expect(server.image).toBe(PHOTO);
  });

  describe('on a phone', () => {
    beforeEach(() => {
      atWidth(390);
    });

    const bar = () => screen.queryByRole('region', { name: 'Unsaved changes' });

    it('shows a bar with Discard and Save only while they have edits', async () => {
      const user = await openSettings();
      expect(bar()).toBeNull();
      // Their Save isn't in the panel on a phone: it's the bar's.
      expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

      // A setting that saves as it changes isn't an edit to keep.
      await user.click(searchable());
      await screen.findByText('Saved');
      expect(bar()).toBeNull();

      await user.type(bio(), ' Plants.');
      expect(bar()).not.toBeNull();
      await user.click(within(bar()!).getByRole('button', { name: 'Discard' }));
      expect(bio()).toHaveValue('I collect mugs.');
      expect(bar()).toBeNull();

      await user.type(bio(), ' Plants.');
      await user.click(within(bar()!).getByRole('button', { name: 'Save' }));
      await waitFor(() => expect(patches).toHaveLength(2));
      expect(patches[1]).toEqual({ bio: 'I collect mugs. Plants.' });
      await waitFor(() => expect(bar()).toBeNull());
    });
  });

  describe('when leaving the page with edits', () => {
    function appLink(href: string) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'Somewhere else';
      document.body.appendChild(a);
      return a;
    }
    afterEach(() => document.querySelectorAll('a').forEach((a) => a.remove()));

    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it('asks before following a link to another page, and stays on Keep editing', async () => {
      const user = await openSettings();
      const link = appLink('/wishlists/mine');
      await user.type(bio(), ' Plants.');

      await user.click(link);
      const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
      expect(push).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
      expect(screen.queryByRole('alertdialog', { name: 'Discard changes?' })).toBeNull();
      expect(bio()).toHaveValue('I collect mugs. Plants.');

      await user.click(link);
      await user.click(
        within(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).getByRole(
          'button',
          { name: 'Discard' }
        )
      );
      expect(push).toHaveBeenCalledWith('/wishlists/mine');
      expect(bio()).toHaveValue('I collect mugs.');
    });

    it('asks the browser to confirm a reload or close only while there are edits', async () => {
      const user = await openSettings();
      expect(unload()).toBe(false);

      await user.type(bio(), ' Plants.');
      expect(unload()).toBe(true);

      await user.click(saveText());
      await screen.findByText('Saved');
      expect(unload()).toBe(false);
    });

    it('lets a link through when only instant settings changed', async () => {
      const user = await openSettings();
      const link = appLink('/wishlists/mine');
      await user.click(searchable());
      await screen.findByText('Saved');

      await user.click(link);
      expect(screen.queryByRole('alertdialog', { name: 'Discard changes?' })).toBeNull();
      expect(unload()).toBe(false);
    });
  });
});

describe('the profile link', () => {
  it('copies the full link to your profile, and opens it in a new tab', async () => {
    const user = await openSettings();
    // After user-event's setup, which puts a clipboard of its own in place.
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    expect(screen.getByText(`${window.location.host}/users/alice`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy your profile link' }));

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/users/alice`);
    expect(await screen.findByRole('button', { name: 'Copied your profile link' })).toBeVisible();
    expect(showToast).toHaveBeenCalledWith('Profile link copied to clipboard', 'success');

    const view = screen.getByRole('link', { name: /view your profile/i });
    expect(view).toHaveAttribute('href', '/users/alice');
    expect(view).toHaveAttribute('target', '_blank');
  });

  it('says so when the link can’t be copied', async () => {
    const user = await openSettings();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    await user.click(screen.getByRole('button', { name: 'Copy your profile link' }));
    expect(showToast).toHaveBeenCalledWith('Could not copy your profile link', 'error');
  });
});

describe('the account', () => {
  it('shows your own email, and signs out to home', async () => {
    const user = await openSettings();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/' });
  });

  it('asks before signing out with the bio unsaved', async () => {
    const user = await openSettings();
    await user.type(bio(), ' Plants.');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    expect(signOut).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(signOut).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await user.click(
      within(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).getByRole(
        'button',
        { name: 'Discard' }
      )
    );
    expect(signOut).toHaveBeenCalledWith({ redirectTo: '/' });
  });
});

describe('settings that couldn’t be loaded', () => {
  // regression: a failed read of the profile left the form up, blank (no
  // username, USD) and editable, as if the account had lost its settings, with
  // a Save that could never turn on. A 500 didn't even toast.
  it.each(['server', 'network'] as const)(
    'regression: shows no form until the profile is read, and says so when that fails (%s)',
    async (failure) => {
      failGet = failure;
      render(<SettingsPage />);

      await screen.findByRole('heading', { name: 'Couldn’t load your settings' });
      expect(screen.queryByRole('switch', { name: 'Searchable' })).toBeNull();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('combobox', { name: 'Default currency' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(showToast).not.toHaveBeenCalled();

      failGet = null;
      await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

      // The form, filled from the profile.
      await screen.findByRole('switch', { name: 'Searchable' });
      expect(screen.getByRole('textbox', { name: 'Bio' })).toHaveValue('I collect mugs.');
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Couldn’t load your settings' })).toBeNull();
      expect(gets).toBe(2);
      expect(showToast).not.toHaveBeenCalled();
    }
  );

  it('keeps the form when a reload after a save fails', async () => {
    const user = await openSettings();
    update.mockImplementation(async () => {
      auth.set('loading');
      await Promise.resolve();
      auth.set('authenticated');
    });

    // A photo change refreshes the session, which reads the profile again: that read fails.
    failGet = 'network';
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await waitFor(() => expect(gets).toBe(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByRole('switch', { name: 'Searchable' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Bio' })).toHaveValue('I collect mugs.');
    expect(screen.queryByRole('heading', { name: 'Couldn’t load your settings' })).toBeNull();
    expect(showToast).toHaveBeenCalledWith('Failed to load settings', 'error');
  });
});
