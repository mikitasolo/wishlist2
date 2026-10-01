import { describe, it, expect } from 'vitest';
import { usernameQuery } from '@/lib/utils/searchQuery';

describe('usernameQuery', () => {
  it('drops a leading @, as handles are shown and shared', () => {
    expect(usernameQuery('@alice')).toBe('alice');
    expect(usernameQuery('alice')).toBe('alice');
  });

  it('trims and lowercases, around the @ too', () => {
    expect(usernameQuery('  @Alice  ')).toBe('alice');
    expect(usernameQuery('@ alice')).toBe('alice');
    expect(usernameQuery('ALICE')).toBe('alice');
  });

  it('is empty for a bare @ or nothing at all', () => {
    expect(usernameQuery('@')).toBe('');
    expect(usernameQuery('  @  ')).toBe('');
    expect(usernameQuery('')).toBe('');
  });

  it('drops only one @, and only at the start', () => {
    expect(usernameQuery('@@alice')).toBe('@alice');
    expect(usernameQuery('al@ice')).toBe('al@ice');
    expect(usernameQuery('alice@')).toBe('alice@');
  });
});
