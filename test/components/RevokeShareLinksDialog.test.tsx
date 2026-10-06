// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import RevokeShareLinksDialog, {
  NO_LINKS_LEFT_TEXT,
  REVOKE_LINKS_TITLE,
} from '@/components/RevokeShareLinksDialog';
import type { ShareLinkRow } from '@/lib/hooks/useShareLinks';

const NOW = new Date('2026-10-05T12:00:00Z');

const row = (over: Partial<ShareLinkRow>): ShareLinkRow => ({
  _id: 'l1',
  level: 'view',
  label: null,
  expiresAt: null,
  untilOccasion: false,
  createdAt: '2026-10-01T00:00:00Z',
  state: 'live',
  joinedCount: 0,
  ...over,
});

const LINKS = [
  row({ _id: 'family', label: 'Family chat', level: 'join', joinedCount: 3 }),
  row({ _id: 'qr', label: null, level: 'view' }),
  row({ _id: 'old', label: 'Old QR', state: 'expired', expiresAt: '2026-09-01T00:00:00Z' }),
  // Live by the last read, run out since.
  row({ _id: 'lapsed', label: 'Lapsed', expiresAt: '2026-10-05T11:00:00Z' }),
];

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
afterEach(cleanup);

/** The dialog over links that `revoke` takes away, as `useShareLinks` does. */
function Harness({
  revoke,
  onDone = () => {},
}: {
  revoke: (id: string) => Promise<boolean>;
  onDone?: () => void;
}) {
  const [links, setLinks] = useState(LINKS);
  return (
    <RevokeShareLinksDialog
      username="bob"
      links={links}
      now={NOW}
      onDone={onDone}
      onRevoke={async (id) => {
        const ok = await revoke(id);
        if (ok) setLinks((prev) => prev.filter((l) => l._id !== id));
        return ok;
      }}
    />
  );
}

describe('RevokeShareLinksDialog', () => {
  it('names the ex-owner and lists only the live links, with level and joined count', () => {
    render(<Harness revoke={async () => true} />);
    const dialog = screen.getByRole('dialog', { name: REVOKE_LINKS_TITLE });
    expect(
      within(dialog).getByText("@bob could copy this list's share links.")
    ).toBeInTheDocument();
    const items = within(within(dialog).getByRole('list', { name: 'Share links' })).getAllByRole(
      'listitem'
    );
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^Family chatCan join3 people joinedRevoke$/),
      expect.stringMatching(/^Untitled linkCan viewRevoke$/),
    ]);
  });

  it('revokes one link and keeps the others, then says when none are left', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const revoke = vi.fn(
      (id: string) =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
          void id;
        })
    );
    render(<Harness revoke={revoke} />);

    await user.click(screen.getByRole('button', { name: 'Revoke Family chat' }));
    expect(revoke).toHaveBeenCalledWith('family');
    // Held while it runs, so a second click sends nothing.
    const pending = screen.getByRole('button', { name: 'Revoke Family chat' });
    expect(pending).toBeDisabled();
    expect(pending).toHaveTextContent('Revoking…');
    await user.click(pending);
    expect(revoke).toHaveBeenCalledTimes(1);

    release();
    expect(await screen.findByRole('button', { name: 'Revoke Untitled link' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Revoke Family chat' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Revoke Untitled link' }));
    release();
    expect(await screen.findByText(NO_LINKS_LEFT_TEXT)).toBeInTheDocument();
  });

  it('keeps a link whose revoke failed, ready to try again', async () => {
    const user = userEvent.setup();
    const revoke = vi.fn(async () => false);
    render(<Harness revoke={revoke} />);
    await user.click(screen.getByRole('button', { name: 'Revoke Family chat' }));
    expect(await screen.findByRole('button', { name: 'Revoke Family chat' })).toBeEnabled();
  });

  it('Done closes it without revoking anything', async () => {
    const user = userEvent.setup();
    const revoke = vi.fn(async () => true);
    const onDone = vi.fn();
    render(<Harness revoke={revoke} onDone={onDone} />);
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(revoke).not.toHaveBeenCalled();
  });
});
