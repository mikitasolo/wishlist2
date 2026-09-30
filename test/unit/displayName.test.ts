import { describe, it, expect } from 'vitest';
import { publicDisplayName, type NamedUser } from '@/lib/utils/displayName';

describe('publicDisplayName', () => {
  it('prefers the username', () => {
    expect(publicDisplayName({ username: 'jane', name: 'Jane Doe' })).toBe('jane');
  });

  it('falls back to the name when there is no username', () => {
    expect(publicDisplayName({ username: null, name: 'Jane Doe' })).toBe('Jane Doe');
    expect(publicDisplayName({ username: '  ', name: '  Jane Doe ' })).toBe('Jane Doe');
  });

  it('falls back to "Someone" when there is neither', () => {
    expect(publicDisplayName({})).toBe('Someone');
    expect(publicDisplayName({ username: '', name: '' })).toBe('Someone');
    expect(publicDisplayName(null)).toBe('Someone');
    expect(publicDisplayName(undefined)).toBe('Someone');
  });

  // regression: the invite routes fell back to `email.split('@')[0]`, so an
  // inviter with no username had their email's local part emailed to the invitee.
  it('regression: never derives a name from the email address', () => {
    const user = { email: 'jane.doe@example.com', username: null, name: null };
    const shown = publicDisplayName(user);
    expect(shown).toBe('Someone');
    expect(shown).not.toContain('jane');
    expect(shown).not.toContain('example');
  });

  it('skips a name that is an email address', () => {
    expect(publicDisplayName({ name: 'jane.doe@example.com' })).toBe('Someone');
  });

  it('ignores a name that is not a string (it comes from the raw DB row)', () => {
    const odd = { name: { first: 'Jo' } } as unknown as NamedUser;
    expect(publicDisplayName(odd)).toBe('Someone');
  });
});
