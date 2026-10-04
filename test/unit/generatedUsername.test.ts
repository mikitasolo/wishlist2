import { describe, it, expect } from 'vitest';
import { isGeneratedUsername } from '@/lib/utils/generatedUsername';
import { GENERATED_USERNAME_PREFIX } from '@/lib/utils/username';

describe('isGeneratedUsername', () => {
  it('matches user_ plus 8 lowercase base36 characters', () => {
    expect(isGeneratedUsername('user_6okeewqv')).toBe(true);
    expect(isGeneratedUsername(`${GENERATED_USERNAME_PREFIX}12345678`)).toBe(true);
  });

  it('is false for anything else', () => {
    const others = [
      'maria_nowak',
      'user_short',
      'user_123456789',
      'user_ABCDEFGH',
      'xuser_6okeewqv',
      '',
      null,
      undefined,
    ];
    for (const name of others) expect(isGeneratedUsername(name), String(name)).toBe(false);
  });
});
