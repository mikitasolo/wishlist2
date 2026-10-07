import { describe, it, expect } from 'vitest';
import {
  groupInviteCutShortNote,
  groupInviteHeadline,
  groupPersonLabel,
} from '@/lib/utils/groupInviteResult';

const p = (id: string, username: string = id) => ({ id, username, displayName: username });

describe('group invite result copy (WIS-37)', () => {
  it('names people by handle', () => {
    expect(groupPersonLabel(p('bo'))).toBe('@bo');
  });

  it('heads the result with how many were invited', () => {
    expect(groupInviteHeadline({ invited: [p('a')], skipped: [], notInvited: 0 })).toBe(
      'Invited 1 person.'
    );
    expect(groupInviteHeadline({ invited: [p('a'), p('b')], skipped: [], notInvited: 0 })).toBe(
      'Invited 2 people.'
    );
    expect(
      groupInviteHeadline({ invited: [], skipped: [{ ...p('a'), reason: 'r' }], notInvited: 0 })
    ).toBe('No one was invited.');
    expect(groupInviteHeadline({ invited: [], skipped: [], notInvited: 1 })).toBe(
      'No one was invited.'
    );
    expect(groupInviteHeadline({ invited: [], skipped: [], notInvited: 0 })).toBe(
      'There’s no one in this group to invite.'
    );
  });

  it('says how many the rate limit left out, only when it did', () => {
    expect(groupInviteCutShortNote({ invited: [], skipped: [], notInvited: 0 })).toBeNull();
    expect(groupInviteCutShortNote({ invited: [], skipped: [], notInvited: 1 })).toMatch(
      /^1 more person wasn’t invited/
    );
    expect(groupInviteCutShortNote({ invited: [], skipped: [], notInvited: 3 })).toMatch(
      /^3 more people weren’t invited/
    );
  });
});
