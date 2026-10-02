import { describe, it, expect } from 'vitest';
import { createListChangeLog, mergeRefreshedList, type ListChanges } from '@/lib/utils/listRefresh';

interface Entry {
  _id: string;
  name: string;
  at?: number;
}

const entry = (id: string, name = id, at?: number): Entry => ({ _id: id, name, at });
const ids = (list: Entry[]) => list.map((e) => e._id);
const none: ListChanges = { added: new Set(), removed: new Set() };
const changes = ({ added = [], removed = [] }: { added?: string[]; removed?: string[] }) => ({
  added: new Set(added),
  removed: new Set(removed),
});

describe('mergeRefreshedList', () => {
  it('takes the read as is when the page has changed nothing since sending it', () => {
    const current = [entry('a'), entry('b'), entry('c')];
    // Elsewhere, b went, d came, and a changed.
    const read = [entry('d'), entry('a', 'a, renamed'), entry('c')];

    expect(mergeRefreshedList(current, read, none)).toEqual(read);
  });

  it('never brings back an entry the page took off while the read was in flight', () => {
    const current = [entry('a'), entry('c')];
    // Answered before the page's delete of b was saved.
    const read = [entry('a'), entry('b'), entry('c')];

    expect(ids(mergeRefreshedList(current, read, changes({ removed: ['b'] })))).toEqual(['a', 'c']);
  });

  it('never drops an entry the page put on while the read was in flight', () => {
    const current = [entry('new'), entry('a'), entry('b')];
    // Answered before the page's own write of `new` was saved, and after b went elsewhere.
    const read = [entry('a')];

    expect(ids(mergeRefreshedList(current, read, changes({ added: ['new'] })))).toEqual([
      'new',
      'a',
    ]);
  });

  it("takes the read's copy of an entry the page put on, when the read has it too", () => {
    const current = [entry('new', 'local')];
    const read = [entry('new', 'server')];

    expect(mergeRefreshedList(current, read, changes({ added: ['new'] }))).toEqual(read);
  });

  it("drops an entry the read lacks once the page's change to it predates the read", () => {
    // The page added b before sending the read (so it isn't among the changes),
    // and it has gone elsewhere since.
    expect(ids(mergeRefreshedList([entry('a'), entry('b')], [entry('a')], none))).toEqual(['a']);
  });

  it('leaves an entry whose action is in flight exactly as the page has it', () => {
    const current = [entry('a'), entry('busy', 'local'), entry('b')];
    const held = (id: string) => id === 'busy';

    // The read lacks it (its action may already be saved): it stays, where it was.
    expect(mergeRefreshedList(current, [entry('a'), entry('b')], none, { held })).toEqual(current);

    // The read has a newer copy: the page's stays.
    expect(
      mergeRefreshedList(current, [entry('a'), entry('busy', 'server'), entry('b')], none, {
        held,
      })
    ).toEqual(current);
  });

  it('keeps an entry the page took off off, even while its action is still in flight', () => {
    // The action took its card off (a 404) and hasn't finished yet.
    const merged = mergeRefreshedList(
      [entry('a')],
      [entry('a'), entry('gone')],
      changes({ removed: ['gone'] }),
      {
        held: (id) => id === 'gone',
      }
    );
    expect(ids(merged)).toEqual(['a']);
  });

  it('puts a kept entry right after the one it follows on the page, or at the top', () => {
    const current = [entry('first'), entry('a'), entry('mid'), entry('b')];
    const held = (id: string) => id === 'first' || id === 'mid';
    // New entries elsewhere: x on top, y between a and b.
    const read = [entry('x'), entry('a'), entry('y'), entry('b')];

    expect(ids(mergeRefreshedList(current, read, none, { held }))).toEqual([
      'first',
      'x',
      'a',
      'mid',
      'y',
      'b',
    ]);
  });

  it('sorts the merged list with `compare`', () => {
    const newestFirst = (p: Entry, q: Entry) => (q.at ?? 0) - (p.at ?? 0);
    const current = [entry('added', 'added', 5), entry('old', 'old', 1)];
    const read = [
      entry('elsewhere', 'elsewhere', 7),
      entry('mid', 'mid', 3),
      entry('old', 'old', 1),
    ];

    expect(
      ids(
        mergeRefreshedList(current, read, changes({ added: ['added'] }), { compare: newestFirst })
      )
    ).toEqual(['elsewhere', 'added', 'mid', 'old']);
  });

  it('lists an entry once, even if the read or the page repeats it', () => {
    expect(ids(mergeRefreshedList([], [entry('a'), entry('a')], none))).toEqual(['a']);
    expect(
      ids(
        mergeRefreshedList(
          [entry('new'), entry('a'), entry('new')],
          [entry('a')],
          changes({ added: ['new'] })
        )
      )
    ).toEqual(['new', 'a']);
  });

  it('leaves its inputs alone', () => {
    const current = [entry('a'), entry('busy')];
    const read = [entry('b')];
    mergeRefreshedList(current, read, changes({ added: ['a'] }), {
      held: (id) => id === 'busy',
      compare: (p, q) => p._id.localeCompare(q._id),
    });
    expect(ids(current)).toEqual(['a', 'busy']);
    expect(ids(read)).toEqual(['b']);
  });
});

describe('createListChangeLog', () => {
  it('lands a read with the changes made after it was sent, and only those', () => {
    const log = createListChangeLog();
    log.added('before');
    const sentAt = log.stamp();
    log.added('new');
    log.removed('deleted');

    const landed = log.land(sentAt);
    expect(landed).not.toBeNull();
    expect([...landed!.added]).toEqual(['new']);
    expect([...landed!.removed]).toEqual(['deleted']);
  });

  it('ignores a read landing after one sent later', () => {
    const log = createListChangeLog();
    const older = log.stamp();
    const newer = log.stamp();

    expect(log.land(newer)).not.toBeNull();
    expect(log.outdated(older)).toBe(true);
    expect(log.land(older)).toBeNull();
    // A read lands once.
    expect(log.land(newer)).toBeNull();
  });

  it('still lands an older read first, and then the newer one with its own changes', () => {
    const log = createListChangeLog();
    const older = log.stamp();
    log.removed('a');
    const newer = log.stamp();
    log.removed('b');

    expect([...log.land(older)!.removed]).toEqual(['a', 'b']);
    // `a` was saved before the newer read was sent, so it has it already.
    expect([...log.land(newer)!.removed]).toEqual(['b']);
  });

  it('needs nothing merged into a read sent once the changes before it have landed', () => {
    const log = createListChangeLog();
    log.removed('a');
    const first = log.stamp();
    log.removed('b');
    log.land(log.stamp());

    // `first` is outdated now, and a read sent from here on needs nothing merged.
    expect(log.land(first)).toBeNull();
    const next = log.stamp();
    expect(log.land(next)).toEqual({ added: new Set(), removed: new Set() });
  });

  it('outdates every read sent before a reset, and drops what it had recorded', () => {
    const log = createListChangeLog();
    const before = log.stamp();
    log.added('previous-account');
    log.reset();

    expect(log.outdated(before)).toBe(true);
    expect(log.land(before)).toBeNull();

    const after = log.stamp();
    expect(log.outdated(after)).toBe(false);
    expect(log.land(after)).toEqual({ added: new Set(), removed: new Set() });
  });

  it('takes its stamps from the clock it is given', () => {
    let t = 100;
    const log = createListChangeLog(() => (t += 10));
    expect(log.stamp()).toBe(110);
    log.removed('a'); // at 120
    expect([...log.land(115)!.removed]).toEqual(['a']);
  });
});
