// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnsubscribeConfirm from '@/components/UnsubscribeConfirm';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const QUERY = 'u=64b7f0c2a1b2c3d4e5f60718&e=proposal&t=sig';

describe('UnsubscribeConfirm', () => {
  it('changes nothing until the button is pressed', () => {
    render(<UnsubscribeConfirm query={QUERY} label="Proposals to review" />);
    expect(screen.getByRole('heading', { name: 'Stop emails about proposals to review?' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the signed link and says it is done', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const user = userEvent.setup();
    render(<UnsubscribeConfirm query={QUERY} label="Proposals to review" />);

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/unsubscribe?${QUERY}`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'POST' });
    expect(await screen.findByRole('heading', { name: 'You’re unsubscribed' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Notification settings' })).toHaveAttribute(
      'href',
      '/settings#notifications'
    );
  });

  it('says so and keeps the button when it fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });
    const user = userEvent.setup();
    render(<UnsubscribeConfirm query={QUERY} label="Proposals to review" />);

    await user.click(screen.getByRole('button', { name: 'Unsubscribe' }));

    expect(await screen.findByText('Couldn’t unsubscribe. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsubscribe' })).toBeEnabled();
  });
});
