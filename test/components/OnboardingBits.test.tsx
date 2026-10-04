// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));

import OwnHandle from '@/components/OwnHandle';
import StarterCard from '@/components/StarterCard';
import UsernameNudge from '@/components/UsernameNudge';

const writeText = vi.fn();

beforeEach(() => {
  cleanup();
  showToast.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  localStorage.clear();
});

describe('OwnHandle', () => {
  it('shows the handle and copies the profile link for it', async () => {
    render(<OwnHandle username="maria_nowak" />);
    expect(screen.getByText('@maria_nowak')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy your profile link' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/users/maria_nowak`)
    );
    expect(await screen.findByRole('button', { name: 'Copied your profile link' })).toBeVisible();
  });

  it('says so when the link can’t be copied', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<OwnHandle username="maria_nowak" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy your profile link' }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not copy your profile link', 'error')
    );
  });
});

describe('StarterCard', () => {
  it('lists the three steps, the first opening the create dialog', () => {
    const onCreate = vi.fn();
    render(<StarterCard username="maria_nowak" onCreate={onCreate} />);

    expect(screen.getByText('Create a list')).toBeInTheDocument();
    expect(screen.getByText(/Add a few things/)).toBeInTheDocument();
    expect(screen.getByText(/Friends invite you by username/)).toBeInTheDocument();
    expect(screen.getByText('@maria_nowak')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create wishlist' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('names no handle for an account without a username', () => {
    render(<StarterCard username={null} onCreate={vi.fn()} />);
    expect(screen.getByText('Share it')).toBeInTheDocument();
    expect(screen.queryByText(/@/)).toBeNull();
  });
});

describe('UsernameNudge', () => {
  const nudge = () => screen.queryByText(/Pick a username friends will recognise/);

  it('shows for a generated handle, links to Settings, and stays dismissed', async () => {
    const { unmount } = render(<UsernameNudge userId="u1" username="user_6okeewqv" />);
    expect(await screen.findByText(/Pick a username friends will recognise/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a username' })).toHaveAttribute(
      'href',
      '/settings'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(nudge()).toBeNull();
    unmount();

    render(<UsernameNudge userId="u1" username="user_6okeewqv" />);
    await waitFor(() => expect(nudge()).toBeNull());
    // Another account in this browser still gets it.
    cleanup();
    render(<UsernameNudge userId="u2" username="user_6okeewqv" />);
    expect(await screen.findByText(/Pick a username/)).toBeInTheDocument();
  });

  it('never shows for a handle they chose', async () => {
    render(<UsernameNudge userId="u1" username="maria_nowak" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(nudge()).toBeNull();
  });
});
