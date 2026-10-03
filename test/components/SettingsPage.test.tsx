// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { push, showToast, update, upload, auth } = vi.hoisted(() => {
  // The session's status, which the page reloads the profile on: next-auth's
  // `update()` turns it to `loading` and back.
  let status = 'authenticated';
  const listeners = new Set<() => void>();
  return {
    push: vi.fn(),
    showToast: vi.fn(),
    update: vi.fn(),
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
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// The header has its own fetches and tests; this file is about the settings form.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
// An upload that finishes: the real control crops and posts the file first. It
// ignores `disabled`, like an upload started before the save that finishes
// while it's in flight.
vi.mock('@/components/ImageUpload', () => ({
  default: ({ onChange }: { onChange: (url: string | null) => void }) => (
    <button type="button" onClick={() => onChange(upload.url)}>
      Finish upload
    </button>
  ),
}));

import SettingsPage from '@/app/settings/page';

const PHOTO = 'https://store.public.blob.vercel-storage.com/uploads/me/new.webp';

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
/** Set to make the next PATCH fail. */
let failPatch: boolean;
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
  fetchMock.mockReset();
  upload.url = PHOTO;
  patches = [];
  holdPatch = null;
  failPatch = false;
  holdGet = null;
  gets = 0;
  failGet = null;
  auth.set('authenticated');
  server = {
    _id: 'me',
    email: 'alice@example.com',
    username: 'alice',
    image: null,
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
      if (holdPatch) await holdPatch;
      if (failPatch) {
        failPatch = false;
        return reply({ success: false, error: 'Failed to update profile' }, 500);
      }
      // The route's one write: what it was sent, each privacy setting on its
      // own, over the profile as it is by then.
      const { privacy, ...rest } = body;
      server = { ...server, ...rest, privacy: { ...server.privacy, ...privacy } };
      return reply({ success: true, data: server });
    }
    return reply({ success: false, error: 'Not mocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSettings() {
  const user = userEvent.setup();
  render(<SettingsPage />);
  await screen.findByRole('switch', { name: 'Searchable' });
  return user;
}

const save = () => screen.getByRole('button', { name: /save changes|saving/i });
const searchable = () => screen.getByRole('switch', { name: 'Searchable' });
const visibilityOption = (name: string) =>
  within(screen.getByRole('radiogroup', { name: 'Who can see your wishlists' })).getByRole(
    'radio',
    {
      name,
    }
  );

describe('the account settings form', () => {
  // regression: the page sent the whole `privacy` object with every save, as
  // the form loaded it, so changing "Searchable" here wrote back
  // `profileVisibility: everyone` over the friends-only another tab had saved.
  it('regression: a save of one privacy setting sends only it, leaving the visibility another tab set alone', async () => {
    const user = await openSettings();
    // Another tab makes the profile friends-only while this one is open.
    server.privacy = { ...server.privacy, profileVisibility: 'friends' };

    await user.click(searchable());
    await user.click(save());

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ privacy: { searchable: false } });
    expect(server.privacy).toEqual({
      searchable: false,
      whoCanInvite: 'everyone',
      profileVisibility: 'friends',
    });
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Settings saved', 'success'));
  });

  it("refills the form from the profile as saved, so the next save doesn't send the other tab's change back", async () => {
    const user = await openSettings();
    expect(visibilityOption('Everyone')).toHaveAttribute('aria-checked', 'true');
    server.privacy = { ...server.privacy, profileVisibility: 'friends' };

    await user.click(searchable());
    await user.click(save());
    await waitFor(() => expect(patches).toHaveLength(1));

    // The form now shows the other tab's visibility, and has nothing left to send.
    await waitFor(() =>
      expect(visibilityOption('Friends')).toHaveAttribute('aria-checked', 'true')
    );
    expect(save()).toBeDisabled();

    const bio = screen.getByLabelText('Bio');
    await user.clear(bio);
    await user.type(bio, 'Mugs and plants.');
    await user.click(save());

    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ bio: 'Mugs and plants.' });
    expect(server.privacy.profileVisibility).toBe('friends');
  });

  it('sends several changes in one save, the privacy ones under `privacy`', async () => {
    const user = await openSettings();

    await user.click(visibilityOption('Friends'));
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Who can invite you to wishlists' })).getByRole(
        'radio',
        { name: 'No one' }
      )
    );
    await user.type(screen.getByLabelText('Bio'), ' And plants.');
    await user.click(save());

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      bio: 'I collect mugs. And plants.',
      privacy: { whoCanInvite: 'nobody', profileVisibility: 'friends' },
    });
  });

  it('has nothing to save until something changes, and again once it is changed back', async () => {
    const user = await openSettings();
    expect(save()).toBeDisabled();

    await user.click(searchable());
    expect(save()).toBeEnabled();

    await user.click(searchable());
    expect(save()).toBeDisabled();
    expect(patches).toHaveLength(0);
  });

  it('keeps the edits when a save fails, and sends them again', async () => {
    const user = await openSettings();
    failPatch = true;

    await user.click(visibilityOption('Friends'));
    await user.click(save());
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Failed to update profile', 'error')
    );
    expect(visibilityOption('Friends')).toHaveAttribute('aria-checked', 'true');

    await user.click(save());
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual(patches[0]);
    expect(patches[1]).toEqual({ privacy: { profileVisibility: 'friends' } });
    expect(server.privacy.profileVisibility).toBe('friends');
  });

  it('keeps a photo upload that finished while the save was in flight, and sends it next', async () => {
    const user = await openSettings();
    let release!: () => void;
    holdPatch = new Promise((resolve) => (release = resolve));

    await user.click(searchable());
    await user.click(save());
    await waitFor(() => expect(patches).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    holdPatch = null;
    release();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Settings saved', 'success'));

    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ image: PHOTO });
    // The new photo shows in the header once the session is read again.
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  });

  it('reports a save as saved when the session refresh after it fails', async () => {
    const user = await openSettings();
    update.mockRejectedValue(new Error('session down'));

    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    await user.click(save());

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(save()).toHaveTextContent('Save changes'));
    expect(showToast).toHaveBeenCalledWith('Settings saved', 'success');
    expect(showToast).not.toHaveBeenCalledWith('Failed to save settings', 'error');
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
    await user.click(save());
    await waitFor(() => expect(gets).toBe(2));

    // The reload has read the profile but not answered when the next save lands.
    await user.click(await screen.findByRole('switch', { name: 'Searchable' }));
    await user.click(save());
    await waitFor(() => expect(patches).toHaveLength(2));
    await waitFor(() => expect(save()).toBeDisabled());
    expect(server.privacy.searchable).toBe(false);

    // Its answer predates that save, so the form keeps what the save stored.
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(searchable()).toHaveAttribute('aria-checked', 'false');
    expect(save()).toBeDisabled();
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
      expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
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
    await user.click(screen.getByRole('button', { name: 'Finish upload' }));
    failGet = 'network';
    await user.click(save());
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
