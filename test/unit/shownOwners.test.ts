import { describe, it, expect } from 'vitest';
import {
  createOwnerRemovalLog,
  shownOwnersOf,
  withoutOwner,
  type ShownOwners,
} from '@/lib/utils/shownOwners';

const threeOwners: ShownOwners = { ids: ['a', 'b', 'c'], usernames: ['alice', 'bob', 'carol'] };

describe('shownOwnersOf', () => {
  it('takes the owner ids and usernames from a read of the list', () => {
    expect(
      shownOwnersOf({
        owners: ['a', 'b'],
        ownerUsernames: ['alice', 'bob'],
        ownerUsername: 'alice',
      })
    ).toEqual({ ids: ['a', 'b'], usernames: ['alice', 'bob'] });
  });

  it('falls back to the primary owner’s username, then to none', () => {
    expect(shownOwnersOf({ owners: ['a'], ownerUsername: 'alice' })).toEqual({
      ids: ['a'],
      usernames: ['alice'],
    });
    expect(shownOwnersOf({ owners: ['a'] })).toEqual({ ids: ['a'], usernames: [] });
    expect(shownOwnersOf({})).toEqual({ ids: [], usernames: [] });
  });
});

describe('withoutOwner', () => {
  it('takes the owner off the count and the byline, and leaves the others', () => {
    expect(withoutOwner(threeOwners, { id: 'b', username: 'bob' })).toEqual({
      ids: ['a', 'c'],
      usernames: ['alice', 'carol'],
    });
  });

  it('leaves the byline alone for an owner without a username (they were never on it)', () => {
    const owners: ShownOwners = { ids: ['a', 'b'], usernames: ['alice'] };

    expect(withoutOwner(owners, { id: 'b', username: null })).toEqual({
      ids: ['a'],
      usernames: ['alice'],
    });
  });

  it('changes nothing for someone who is no longer an owner', () => {
    expect(withoutOwner(threeOwners, { id: 'x', username: 'xavier' })).toEqual(threeOwners);
  });
});

describe('createOwnerRemovalLog', () => {
  it('takes a read as it is when the page has removed nobody since sending it', () => {
    const log = createOwnerRemovalLog();
    const sentAt = log.stamp();

    expect(log.land(sentAt, threeOwners)).toEqual(threeOwners);
  });

  // The read was answered before the demotion landed, and came back after it.
  it('never puts back an owner the page took off while the read was in flight', () => {
    const log = createOwnerRemovalLog();
    const sentAt = log.stamp();
    log.removed({ id: 'b', username: 'bob' });

    expect(log.land(sentAt, threeOwners)).toEqual({
      ids: ['a', 'c'],
      usernames: ['alice', 'carol'],
    });
  });

  it('takes the owners from a read sent after the removal, as the server then had them', () => {
    const log = createOwnerRemovalLog();
    log.removed({ id: 'b', username: 'bob' });
    // Bob was made an owner again (he accepted a new invite) before this read.
    const sentAt = log.stamp();

    expect(log.land(sentAt, threeOwners)).toEqual(threeOwners);
  });

  it('ignores a read that lands after one sent later', () => {
    const log = createOwnerRemovalLog();
    const older = log.stamp();
    const newer = log.stamp();

    expect(log.land(newer, { ids: ['a'], usernames: ['alice'] })).toEqual({
      ids: ['a'],
      usernames: ['alice'],
    });
    expect(log.land(older, threeOwners)).toBeNull();
  });

  it('takes off every owner removed since the read was sent', () => {
    const log = createOwnerRemovalLog();
    const sentAt = log.stamp();
    log.removed({ id: 'b', username: 'bob' });
    log.removed({ id: 'c', username: null });

    expect(log.land(sentAt, { ids: ['a', 'b', 'c'], usernames: ['alice', 'bob'] })).toEqual({
      ids: ['a'],
      usernames: ['alice'],
    });
  });
});
