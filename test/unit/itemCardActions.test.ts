import { describe, it, expect } from 'vitest';
import {
  cardMenuActions,
  linkSlot,
  savesAsPrimary,
  type CardActionContext,
} from '@/lib/utils/itemCardActions';

const base: CardActionContext = {
  isAuthenticated: true,
  isOwner: false,
  isMember: false,
  status: 'available',
  isCompleted: false,
  isGivenByViewer: false,
  hasLink: false,
  canEdit: true,
  canSave: false,
  canDelete: false,
  canAddLink: false,
};

describe('cardMenuActions', () => {
  it('gives an owner Most wanted and a last Delete…, never a booking action', () => {
    const c = { ...base, isOwner: true, canDelete: true, canSave: true };
    expect(cardMenuActions(c)).toEqual([
      'markReceived',
      'moveToDraft',
      'mostWanted',
      'saveToList',
      'delete',
    ]);
  });

  it('gives a proposal only Decline… to its owner', () => {
    const c = { ...base, isOwner: true, status: 'proposed', canDelete: true };
    expect(cardMenuActions(c)).toEqual(['decline']);
  });

  it('leaves a member without owner actions, and a signed-out visitor without a menu', () => {
    expect(cardMenuActions({ ...base, isMember: true, canSave: true, canDelete: true })).toEqual([
      'saveToList',
    ]);
    expect(cardMenuActions({ ...base, isAuthenticated: false, canSave: true })).toEqual([]);
  });

  it("doesn't repeat Save to my list when it's the primary", () => {
    expect(cardMenuActions({ ...base, canSave: true, primaryIsSave: true })).toEqual([]);
  });
});

describe('link slot', () => {
  it("shows the link, an owner's + link, or nothing", () => {
    expect(linkSlot({ ...base, hasLink: true })).toBe('link');
    expect(linkSlot({ ...base, isOwner: true, canAddLink: true })).toBe('add-link');
    expect(linkSlot({ ...base, isOwner: true, canAddLink: true, status: 'proposed' })).toBe('none');
    expect(linkSlot({ ...base, isMember: true, canAddLink: true })).toBe('none');
    expect(linkSlot({ ...base, isAuthenticated: false })).toBe('none');
  });

  it('makes Save the primary only for a signed-in non-member with no link', () => {
    expect(savesAsPrimary({ ...base, canSave: true })).toBe(true);
    expect(savesAsPrimary({ ...base, canSave: true, hasLink: true })).toBe(false);
    expect(savesAsPrimary({ ...base, canSave: true, isMember: true })).toBe(false);
    expect(savesAsPrimary({ ...base, canSave: true, isAuthenticated: false })).toBe(false);
  });
});
