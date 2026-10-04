// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const { session } = vi.hoisted(() => ({
  session: { value: { data: null, status: 'loading' } as Record<string, unknown> },
}));
vi.mock('next-auth/react', () => ({ useSession: () => session.value }));

import { useKnownSession } from '@/lib/hooks/useKnownSession';

describe('useKnownSession', () => {
  it('reports loading while no session is known yet', () => {
    session.value = { data: null, status: 'loading' };
    expect(renderHook(() => useKnownSession()).result.current.status).toBe('loading');
  });

  // regression: WIS-301, update() keeps `data` but sets status to loading
  it('stays authenticated while update() has a known session loading', () => {
    session.value = { data: { user: { id: 'me' } }, status: 'loading' };
    const { result } = renderHook(() => useKnownSession());
    expect(result.current.status).toBe('authenticated');
    expect(result.current.data?.user?.id).toBe('me');
  });

  it('passes the other states through', () => {
    session.value = { data: null, status: 'unauthenticated' };
    expect(renderHook(() => useKnownSession()).result.current.status).toBe('unauthenticated');
  });
});
