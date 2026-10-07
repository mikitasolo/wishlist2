'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GroupPerson, GroupView } from '@/lib/utils/groupRules';
import { withRequestTimeout } from '@/lib/utils/requestTimeout';

export type { GroupPerson, GroupView };

const GENERIC_ERROR = 'Couldn’t save. Try again.';

type Answer = { ok: true; data: unknown } | { ok: false; status: number; error: string };

/**
 * A write to the groups API. A refusal carries the route's own words when it's
 * something the person can act on (a taken name, a full group), never a
 * validation dump or a server error.
 */
async function send(url: string, method: string, body?: unknown): Promise<Answer> {
  try {
    const res = await withRequestTimeout((signal) =>
      fetch(url, {
        method,
        signal,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
    );
    const result = await res.json().catch(() => null);
    if (res.ok && result?.success) return { ok: true, data: result.data };
    const said = result?.error;
    const error =
      res.status >= 400 &&
      res.status < 500 &&
      typeof said === 'string' &&
      !said.startsWith('Validation error')
        ? said
        : GENERIC_ERROR;
    return { ok: false, status: res.status, error };
  } catch {
    return { ok: false, status: 0, error: GENERIC_ERROR };
  }
}

function sortPeople(people: GroupPerson[]): GroupPerson[] {
  return [...people].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * The signed-in person's own groups (WIS-27), for Settings → Groups and a
 * profile's Tag into groups. `groups` is null until the first read lands and
 * `failed` says that read failed (never shown as no groups). Each change is
 * shown once it's saved, except tagging, which shows at once and goes back if
 * its request fails. Every write resolves to null, or the message to show.
 */
export function usePeopleGroups(enabled = true) {
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const groupsRef = useRef<GroupView[] | null>(null);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setFailed(false);
    fetch('/api/users/me/groups', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((result) => {
        if (cancelled) return;
        if (!result?.success || !Array.isArray(result.data)) throw new Error('bad answer');
        setGroups(result.data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const update = (id: string, change: (g: GroupView) => GroupView) =>
    setGroups((gs) => gs?.map((g) => (g.id === id ? change(g) : g)) ?? gs);

  /** Make a group; resolves to it, or the message to show. */
  async function create(name: string): Promise<{ group: GroupView } | { error: string }> {
    const answer = await send('/api/users/me/groups', 'POST', { name });
    if (!answer.ok) return { error: answer.error };
    const group = answer.data as GroupView;
    // Known at once, so it can be tagged into before the next render.
    groupsRef.current = [...(groupsRef.current ?? []), group];
    setGroups((gs) => [...(gs ?? []), group]);
    return { group };
  }

  async function rename(id: string, name: string): Promise<string | null> {
    const answer = await send(`/api/users/me/groups/${id}`, 'PATCH', { name });
    if (!answer.ok) return answer.error;
    update(id, (g) => ({ ...g, name }));
    return null;
  }

  async function remove(id: string): Promise<string | null> {
    const answer = await send(`/api/users/me/groups/${id}`, 'DELETE');
    // Gone already (deleted on another device) is as good as deleted here.
    if (!answer.ok && answer.status !== 404) return answer.error;
    setGroups((gs) => gs?.filter((g) => g.id !== id) ?? gs);
    return null;
  }

  /** Tag `person` into a group or take them out, shown at once; undone if it fails. */
  async function setTagged(id: string, person: GroupPerson, on: boolean): Promise<string | null> {
    const before = groupsRef.current?.find((g) => g.id === id);
    if (!before) return GENERIC_ERROR;
    const wasIn = before.members.some((m) => m.id === person.id);
    if (wasIn === on) return null;
    const apply = (tagged: boolean) =>
      update(id, (g) => ({
        ...g,
        members: tagged
          ? sortPeople([...g.members.filter((m) => m.id !== person.id), person])
          : g.members.filter((m) => m.id !== person.id),
      }));
    apply(on);
    const answer = on
      ? await send(`/api/users/me/groups/${id}/members`, 'POST', { userId: person.id })
      : await send(`/api/users/me/groups/${id}/members/${person.id}`, 'DELETE');
    if (answer.ok) return null;
    apply(wasIn);
    return answer.error;
  }

  return { groups, failed, retry, create, rename, remove, setTagged };
}
