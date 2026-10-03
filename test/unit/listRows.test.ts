import { describe, it, expect } from 'vitest';
import { rowMeta, rowOwnerLabel } from '@/lib/utils/listRows';

describe('rowOwnerLabel — a list shared with you', () => {
  const shared = { shared: true, viewerId: 'me-id' };

  it('names the owner by username', () => {
    expect(rowOwnerLabel({ owners: ['o1'], ownerUsername: 'ben' }, shared)).toBe('@ben');
  });

  it('adds how many co-owners the list has', () => {
    expect(
      rowOwnerLabel(
        { owners: ['o1', 'o2', 'o3'], ownerUsername: 'dan', ownerUsernames: ['dan', 'fiona'] },
        shared
      )
    ).toBe('@dan +2');
  });

  it('names an owner without a username as publicDisplayName does, never by email', () => {
    expect(rowOwnerLabel({ owners: ['o1'], ownerUsername: null }, shared)).toBe('Someone');
  });

  it('counts the usernames it was sent when there are no owner ids', () => {
    expect(rowOwnerLabel({ ownerUsername: 'dan', ownerUsernames: ['dan', 'fiona'] }, shared)).toBe(
      '@dan +1'
    );
  });
});

describe('rowOwnerLabel — your own list', () => {
  const own = { shared: false, viewerId: 'me-id' };

  it('says nothing on a list that is yours alone', () => {
    expect(rowOwnerLabel({ owners: ['me-id'], ownerUsername: 'me' }, own)).toBeNull();
  });

  it('names the co-owner you share it with, not you, whoever is primary', () => {
    const list = { owners: ['me-id', 'b-id'], ownerUsernames: ['me', 'ben'] };
    expect(rowOwnerLabel({ ...list, ownerUsername: 'me' }, own)).toBe('with @ben');
    expect(
      rowOwnerLabel(
        { owners: ['b-id', 'me-id'], ownerUsername: 'ben', ownerUsernames: ['ben', 'me'] },
        own
      )
    ).toBe('with @ben');
  });

  it('adds the other co-owners as a count', () => {
    expect(
      rowOwnerLabel(
        { owners: ['me-id', 'b-id', 'c-id'], ownerUsernames: ['me', 'ben', 'carla'] },
        own
      )
    ).toBe('with @ben +1');
  });

  it('names a co-owner without a username "Someone"', () => {
    expect(rowOwnerLabel({ owners: ['me-id', 'x-id'], ownerUsernames: ['me'] }, own)).toBe(
      'with Someone'
    );
  });

  // The usernames could be stale (a rename in another tab): the viewer is told
  // apart by id, so they're never named as their own co-owner.
  it('tells you apart by id, whatever your username', () => {
    const list = { owners: ['me-id', 'b-id'], ownerUsernames: ['old-me', 'ben'] };
    expect(rowOwnerLabel(list, own)).toBe('with @ben');
    expect(
      rowOwnerLabel({ ...list, owners: ['b-id', 'me-id'], ownerUsernames: ['ben', 'old-me'] }, own)
    ).toBe('with @ben');
  });
});

describe('rowMeta', () => {
  it('is the owner and the published items on a shared list, with no drafts or proposals', () => {
    expect(
      rowMeta(
        // A member is never sent these, but the row wouldn't show them anyway.
        { owners: ['o1'], ownerUsername: 'ben', itemCount: 9, draftCount: 2, proposalCount: 1 },
        { shared: true }
      )
    ).toBe('@ben · 9 items');
  });

  it('is your list’s items with its drafts and proposals to review, as its card says', () => {
    expect(
      rowMeta(
        { owners: ['me-id'], itemCount: 11, draftCount: 2, proposalCount: 1 },
        { shared: false, viewerId: 'me-id' }
      )
    ).toBe('11 items · 2 drafts · 1 to review');
    expect(rowMeta({ owners: ['me-id'], itemCount: 1 }, { shared: false })).toBe('1 item');
  });

  it('puts the co-owners first on a co-owned list of yours', () => {
    expect(
      rowMeta(
        { owners: ['me-id', 'b-id'], ownerUsernames: ['me', 'ben'], itemCount: 12 },
        { shared: false, viewerId: 'me-id' }
      )
    ).toBe('with @ben · 12 items');
  });

  it('counts a list sent without counts as empty', () => {
    expect(rowMeta({ owners: ['o1'], ownerUsername: 'ben' }, { shared: true })).toBe(
      '@ben · 0 items'
    );
  });
});
