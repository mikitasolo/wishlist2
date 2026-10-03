import { describe, it, expect } from 'vitest';
import { inviteSearchTerm, listStatusByUsername } from '@/lib/utils/inviteSuggestions';

describe('listStatusByUsername', () => {
  it('maps owners, members and invitees by lower-cased username', () => {
    const map = listStatusByUsername({
      owners: ['Olga'],
      members: [{ userId: 'u1', username: 'Mia' }],
      invited: ['ivy'],
    });
    expect(map.get('olga')).toEqual({ status: 'owner' });
    expect(map.get('mia')).toEqual({ status: 'member', userId: 'u1' });
    expect(map.get('ivy')).toEqual({ status: 'invited' });
    expect(map.get('nora')).toBeUndefined();
  });

  it('counts an owner as an owner whatever else they appear as', () => {
    const map = listStatusByUsername({
      owners: ['olga'],
      members: [{ userId: 'u1', username: 'olga' }],
      invited: ['olga'],
    });
    expect(map.get('olga')).toEqual({ status: 'owner' });
  });

  // A member's only possible pending invite is a promotion, and a second one
  // would be refused as already pending.
  it('shows a member with a promotion pending as invited, with nothing to promote', () => {
    const map = listStatusByUsername({
      owners: [],
      members: [{ userId: 'u1', username: 'mia' }],
      invited: ['mia'],
    });
    expect(map.get('mia')).toEqual({ status: 'invited' });
  });

  it('leaves out anyone without a username', () => {
    const map = listStatusByUsername({
      owners: [null, undefined, ''],
      members: [{ userId: 'u1', username: null }],
      invited: [null],
    });
    expect(map.size).toBe(0);
  });
});

describe('inviteSearchTerm', () => {
  it('trims and drops one leading @', () => {
    expect(inviteSearchTerm('  @alice ')).toBe('alice');
    expect(inviteSearchTerm('@@a')).toBe('@a');
    expect(inviteSearchTerm('bob')).toBe('bob');
  });
});
