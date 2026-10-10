// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// WIS-387: Cancel request waits out an Undo window before its DELETE goes.

const showToast = vi.fn();
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }));

import { useJoinRequest } from '@/lib/hooks/useJoinRequest';
import { flushUndoableActions } from '@/lib/hooks/useUndoableAction';

const fetchMock = vi.fn();
let deleteOk = true;

function reply(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const calls = (method: string) =>
  fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') === method);

function undo() {
  const call = [...showToast.mock.calls].reverse().find((c) => c[2]?.action?.label === 'Undo');
  act(() => call![2].action.onClick());
}

async function requested() {
  const view = renderHook(() => useJoinRequest('w1', 'me', true));
  await waitFor(() => expect(view.result.current.state).toBe('requested'));
  return view;
}

beforeEach(() => {
  deleteOk = true;
  showToast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET') return reply({ success: true, data: { requested: true } });
    if (method === 'DELETE') {
      return deleteOk
        ? reply({ success: true, data: { requested: false } })
        : reply({ success: false, error: 'Couldn’t cancel your request' }, 500);
    }
    return reply({ success: true, data: { requested: true } }, 201);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  act(() => flushUndoableActions());
  vi.unstubAllGlobals();
});

describe('useJoinRequest cancel (WIS-387)', () => {
  it('shows it cancelled at once and sends one DELETE only once the window has passed', async () => {
    const { result } = await requested();
    act(() => result.current.cancel());
    expect(result.current.state).toBe('none');
    expect(showToast).toHaveBeenCalledWith(
      'Request cancelled',
      'success',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) })
    );
    expect(calls('DELETE')).toHaveLength(0);
    await act(async () => flushUndoableActions());
    expect(calls('DELETE')).toHaveLength(1);
    expect(result.current.state).toBe('none');
  });

  it('keeps the request, sending nothing, on Undo', async () => {
    const { result } = await requested();
    act(() => result.current.cancel());
    undo();
    expect(result.current.state).toBe('requested');
    await act(async () => flushUndoableActions());
    expect(calls('DELETE')).toHaveLength(0);
  });

  it('takes Ask to join during the window as the Undo: no DELETE and no second ask', async () => {
    const { result } = await requested();
    act(() => result.current.cancel());
    act(() => result.current.ask());
    expect(result.current.state).toBe('requested');
    await act(async () => flushUndoableActions());
    expect(calls('DELETE')).toHaveLength(0);
    expect(calls('POST')).toHaveLength(0);
  });

  it('puts the request back when the deferred cancel fails', async () => {
    deleteOk = false;
    const { result } = await requested();
    act(() => result.current.cancel());
    await act(async () => flushUndoableActions());
    await waitFor(() => expect(result.current.state).toBe('requested'));
    expect(showToast).toHaveBeenCalledWith('Couldn’t cancel your request', 'error');
  });
});
