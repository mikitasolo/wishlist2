import { describe, it, expect } from 'vitest';
import {
  deletionConfirmationTarget,
  matchesDeletionConfirmation,
} from '@/lib/utils/deletionConfirmation';
import { deleteAccountSchema } from '@/lib/validations';

describe('deletionConfirmationTarget', () => {
  it('asks for the username, or the email when there is none', () => {
    expect(deletionConfirmationTarget({ username: 'ann', email: 'a@x.com' })).toEqual({
      kind: 'username',
      value: 'ann',
    });
    expect(deletionConfirmationTarget({ username: '', email: 'a@x.com' })).toEqual({
      kind: 'email',
      value: 'a@x.com',
    });
    expect(deletionConfirmationTarget({ email: 'a@x.com' }).kind).toBe('email');
  });
});

describe('matchesDeletionConfirmation', () => {
  const byName = { kind: 'username', value: 'Ann_1' } as const;
  const byEmail = { kind: 'email', value: 'ann@x.com' } as const;

  it('takes the username ignoring case, surrounding space and a leading @', () => {
    expect(matchesDeletionConfirmation('ann_1', byName)).toBe(true);
    expect(matchesDeletionConfirmation('  @ANN_1 ', byName)).toBe(true);
  });

  it('refuses anything else', () => {
    expect(matchesDeletionConfirmation('ann', byName)).toBe(false);
    expect(matchesDeletionConfirmation('@@ann_1', byName)).toBe(false);
    expect(matchesDeletionConfirmation('', byName)).toBe(false);
    expect(matchesDeletionConfirmation(undefined, byName)).toBe(false);
    expect(matchesDeletionConfirmation(42, byName)).toBe(false);
  });

  it('takes the email ignoring case, but not with an @ put in front', () => {
    expect(matchesDeletionConfirmation('ANN@x.com', byEmail)).toBe(true);
    expect(matchesDeletionConfirmation('@ann@x.com', byEmail)).toBe(false);
  });

  it('never matches an empty target', () => {
    expect(matchesDeletionConfirmation('', { kind: 'email', value: '' })).toBe(false);
  });
});

describe('deleteAccountSchema', () => {
  it('needs a string confirmation of a sane length', () => {
    expect(deleteAccountSchema.safeParse({ confirm: 'ann' }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({}).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirm: 'x'.repeat(321) }).success).toBe(false);
  });
});
