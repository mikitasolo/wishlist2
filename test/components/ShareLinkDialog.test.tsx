// @vitest-environment jsdom
// New link / Edit link (WIS-335): level and expiry defaults, the Public-list
// note, the expired-link warning, an edit sending only what changed, and
// Create for print (WIS-328).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShareLinkDialog, {
  PRINT_LINK_LABEL,
  PUBLIC_VIEW_LINK_NOTE,
  REVIVAL_WARNING,
} from '@/components/ShareLinkDialog';
import type { ShareLinkRow } from '@/lib/hooks/useShareLinks';
import type { Occasion } from '@/lib/utils/occasion';

afterEach(() => cleanup());

const now = new Date(2026, 5, 1, 15, 30);
const birthday: Occasion = { kind: 'birthday', date: '2000-06-12', recurrence: 'yearly' };
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();
const expires = () => screen.getByRole('combobox', { name: 'Expires' });
const radio = (name: string) => screen.getByRole('radio', { name });

function renderCreate(
  over: Partial<{ visibility: 'everyone' | 'friends' | 'private'; occasion: Occasion | null }> = {}
) {
  const onCreate = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(
    <ShareLinkDialog
      mode="create"
      visibility={over.visibility ?? 'private'}
      occasion={over.occasion ?? null}
      onCreate={onCreate}
      onClose={onClose}
      now={now}
    />
  );
  return { onCreate, onClose };
}

const link = (over: Partial<ShareLinkRow> = {}): ShareLinkRow => ({
  _id: 'l1',
  level: 'join',
  label: 'Family chat',
  expiresAt: null,
  createdAt: now.toISOString(),
  state: 'live',
  joinedCount: 0,
  token: 'A'.repeat(22),
  ...over,
});

function renderEdit(row: ShareLinkRow) {
  const onUpdate = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(
    <ShareLinkDialog
      mode="edit"
      link={row}
      visibility="private"
      occasion={birthday}
      onUpdate={onUpdate}
      onClose={onClose}
      now={now}
    />
  );
  return { onUpdate, onClose };
}

describe('ShareLinkDialog: New link', () => {
  it('defaults to View, never expiring, on a list that isn’t Public', () => {
    renderCreate({ occasion: birthday });
    expect(radio('View')).toBeChecked();
    expect(screen.getByText('People can see the list and ask to join.')).toBeInTheDocument();
    expect(expires()).toHaveTextContent('Never');
  });

  it('defaults to Join on a Public list, and says why under View', async () => {
    const user = userEvent.setup();
    renderCreate({ visibility: 'everyone' });
    expect(radio('Join')).toBeChecked();
    expect(
      screen.getByText('People can join the list and reserve gifts, without asking.')
    ).toBeInTheDocument();
    expect(screen.queryByText(PUBLIC_VIEW_LINK_NOTE, { exact: false })).toBeNull();
    await user.click(radio('View'));
    expect(screen.getByText(PUBLIC_VIEW_LINK_NOTE, { exact: false })).toBeInTheDocument();
  });

  it('gives a Join link the day after the occasion by default', async () => {
    const user = userEvent.setup();
    const { onCreate, onClose } = renderCreate({ occasion: birthday });
    await user.click(radio('Join'));
    expect(expires()).toHaveTextContent('Day after the occasion');
    // Back to View: back to Never, as the owner never picked one.
    await user.click(radio('View'));
    expect(expires()).toHaveTextContent('Never');
    await user.click(radio('Join'));
    await user.type(screen.getByLabelText('Label', { exact: false }), 'Wedding QR');
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(onCreate).toHaveBeenCalledWith({
      level: 'join',
      label: 'Wedding QR',
      expiresAt: local(2026, 6, 13),
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('offers no Day after the occasion without an occasion, and Join then never expires', async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(radio('Join'));
    expect(expires()).toHaveTextContent('Never');
    await user.click(expires());
    expect(screen.queryByRole('option', { name: 'Day after the occasion' })).toBeNull();
  });

  it('keeps an expiry the owner picked when the level changes', async () => {
    const user = userEvent.setup();
    renderCreate({ occasion: birthday });
    await user.click(expires());
    await user.click(screen.getByRole('option', { name: '1 month' }));
    await user.click(radio('Join'));
    expect(expires()).toHaveTextContent('1 month');
  });

  it('asks for a custom date after today', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderCreate();
    await user.click(expires());
    await user.click(screen.getByRole('option', { name: 'Custom' }));
    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(screen.getByText('Pick a date after today.')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('creates a link labelled “Printed card” with Create for print, at the chosen level and expiry', async () => {
    const user = userEvent.setup();
    const { onCreate, onClose } = renderCreate({ occasion: birthday });
    await user.click(radio('Join'));
    // A label typed for a chat link doesn't name the print run.
    await user.type(screen.getByLabelText('Label', { exact: false }), 'Family chat');
    await user.click(screen.getByRole('button', { name: 'Create for print' }));
    expect(onCreate).toHaveBeenCalledWith(
      { level: 'join', label: PRINT_LINK_LABEL, expiresAt: local(2026, 6, 13) },
      { forPrint: true }
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for a custom date before Create for print too', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderCreate();
    await user.click(expires());
    await user.click(screen.getByRole('option', { name: 'Custom' }));
    await user.click(screen.getByRole('button', { name: 'Create for print' }));
    expect(screen.getByText('Pick a date after today.')).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('ShareLinkDialog: Edit link', () => {
  it('shows the level without letting it change, and no Create for print', () => {
    renderEdit(link());
    expect(screen.queryByRole('button', { name: 'Create for print' })).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText('Can join')).toBeInTheDocument();
  });

  it('sends only the label when only the label changed', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEdit(link({ expiresAt: local(2026, 7, 1) }));
    const input = screen.getByLabelText('Label', { exact: false });
    await user.clear(input);
    await user.type(input, 'Cousins');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onUpdate).toHaveBeenCalledWith('l1', { label: 'Cousins' });
  });

  it('sends nothing when nothing changed', async () => {
    const user = userEvent.setup();
    const { onUpdate, onClose } = renderEdit(link({ expiresAt: local(2026, 7, 1) }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('warns that a later expiry brings an expired link back, and sends only the expiry', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEdit(link({ expiresAt: local(2026, 5, 20), state: 'expired' }));
    expect(screen.queryByText(REVIVAL_WARNING)).toBeNull();
    fireEvent.change(screen.getByLabelText('Expiry date', { exact: false }), {
      target: { value: '2026-07-01' },
    });
    expect(screen.getByText(REVIVAL_WARNING)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onUpdate).toHaveBeenCalledWith('l1', { expiresAt: local(2026, 7, 1) });
  });

  it('says nothing about reviving a link that hasn’t expired', async () => {
    const user = userEvent.setup();
    renderEdit(link({ expiresAt: local(2026, 7, 1) }));
    await user.click(expires());
    await user.click(screen.getByRole('option', { name: 'Never' }));
    expect(screen.queryByText(REVIVAL_WARNING)).toBeNull();
  });

  // regression: a preset's expiry is a moment mid-day; re-picking its day as a
  // Custom date moved it to that day's midnight, hours earlier.
  it('keeps a stored mid-day expiry when its own day is picked again', async () => {
    const user = userEvent.setup();
    const stored = new Date(2026, 6, 1, 15, 30).toISOString();
    const { onUpdate, onClose } = renderEdit(link({ expiresAt: stored }));
    fireEvent.change(screen.getByLabelText('Expiry date', { exact: false }), {
      target: { value: '2026-07-02' },
    });
    fireEvent.change(screen.getByLabelText('Expiry date', { exact: false }), {
      target: { value: '2026-07-01' },
    });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
