import { describe, it, expect } from 'vitest';
import {
  inviteMetaLine,
  inviteReleaseWarning,
  inviteRoleLabel,
  inviteRoleLine,
} from '@/lib/utils/inviteCard';

const preview = {
  bannerUrl: null,
  occasion: { kind: 'holiday' as const, date: '2026-12-26', recurrence: null },
  itemCount: 12,
};

describe('inviteMetaLine', () => {
  it('names the inviter, the occasion with its countdown and the item count', () => {
    expect(inviteMetaLine({ invitedByUsername: 'chloe_r', preview }, '2026-10-04')).toBe(
      'from @chloe_r · Holiday · in 83 days · 12 items'
    );
  });

  it('shows only the inviter when the invitee cannot open the list yet', () => {
    for (const p of [null, undefined]) {
      expect(inviteMetaLine({ invitedByUsername: 'chloe_r', preview: p }, '2026-10-04')).toBe(
        'from @chloe_r'
      );
    }
  });

  it('says Someone for an inviter with no username', () => {
    expect(inviteMetaLine({ invitedByUsername: null, preview: null }, '2026-10-04')).toBe(
      'from Someone'
    );
  });

  it('shows the occasion kind alone until the local date is known', () => {
    expect(inviteMetaLine({ invitedByUsername: 'chloe_r', preview }, null)).toBe(
      'from @chloe_r · Holiday · 12 items'
    );
  });

  it('never shows a yearly occasion’s stored year, and leaves out a list with no occasion', () => {
    const yearly = {
      ...preview,
      occasion: { kind: 'birthday' as const, date: '2000-10-05', recurrence: 'yearly' as const },
    };
    expect(inviteMetaLine({ invitedByUsername: 'a', preview: yearly }, '2026-10-04')).toBe(
      'from @a · Birthday · tomorrow · 12 items'
    );
    expect(
      inviteMetaLine(
        { invitedByUsername: 'a', preview: { ...preview, occasion: null, itemCount: 1 } },
        '2026-10-04'
      )
    ).toBe('from @a · 1 item');
  });
});

describe('the role', () => {
  it('labels the chip', () => {
    expect(inviteRoleLabel('owner')).toBe('Co-owner');
    expect(inviteRoleLabel('member')).toBe('Member');
  });

  it('says what each role means', () => {
    expect(inviteRoleLine({ role: 'owner', invitedByUsername: 'chloe_r' })).toBe(
      'You’ll edit the list and manage who’s on it.'
    );
    expect(inviteRoleLine({ role: 'member', invitedByUsername: 'ben_carter' })).toBe(
      'You can reserve gifts and suggest items. @ben_carter won’t see who reserved what.'
    );
    expect(inviteRoleLine({ role: 'member', invitedByUsername: null })).toBe(
      'You can reserve gifts and suggest items. The owners won’t see who reserved what.'
    );
  });
});

describe('inviteReleaseWarning', () => {
  it('counts the invitee’s reservations on an owner invite', () => {
    expect(inviteReleaseWarning({ role: 'owner', yourReservations: 2 })).toBe(
      'You’ve reserved 2 gifts here. Co-owners can’t see reservations, so accepting releases them.'
    );
    expect(inviteReleaseWarning({ role: 'owner', yourReservations: 1 })).toBe(
      'You’ve reserved 1 gift here. Co-owners can’t see reservations, so accepting releases it.'
    );
  });

  // regression: every co-owner invite warned that "anything you've reserved here
  // will be released", even to an invitee who had reserved nothing there.
  it('regression: says nothing when they hold no reservation there', () => {
    expect(inviteReleaseWarning({ role: 'owner', yourReservations: 0 })).toBeNull();
    expect(inviteReleaseWarning({ role: 'owner' })).toBeNull();
  });

  it('never warns on a member invite, which releases nothing', () => {
    expect(inviteReleaseWarning({ role: 'member', yourReservations: 3 })).toBeNull();
  });
});
