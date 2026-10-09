// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup, waitFor } from '@testing-library/react';

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { useShareLinks } from '@/lib/hooks/useShareLinks';
import { track } from '@/lib/analytics';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let created: Response;

beforeEach(() => {
  showToast.mockReset();
  vi.mocked(track).mockReset();
  created = reply({
    success: true,
    data: { _id: 'l1', token: TOKEN, level: 'view', label: null, expiresAt: null },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit = {}) =>
      init.method === 'POST' ? created : reply({ success: true, data: [] })
    )
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// WIS-329: a share link made is an owner sharing their list (the funnel's
// "first share"): counted once it exists, never with its token or list.
describe('useShareLinks — analytics', () => {
  it('counts a link once it has been created', async () => {
    const { result } = renderHook(() => useShareLinks('w1', true));
    await waitFor(() => expect(result.current.read).toBe('loaded'));
    await act(() => result.current.create({ level: 'view', label: null, expiresAt: null }));
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('list_shared', { method: 'share_link' });
    expect(JSON.stringify(vi.mocked(track).mock.calls)).not.toContain(TOKEN);
  });

  it('counts nothing when the create is refused', async () => {
    created = reply({ success: false, error: 'Too many links' }, 409);
    const { result } = renderHook(() => useShareLinks('w1', true));
    await waitFor(() => expect(result.current.read).toBe('loaded'));
    await act(() => result.current.create({ level: 'view', label: null, expiresAt: null }));
    expect(showToast).toHaveBeenCalledWith('Too many links', 'error');
    expect(track).not.toHaveBeenCalled();
  });
});
