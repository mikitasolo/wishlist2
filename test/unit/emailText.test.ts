import { describe, it, expect } from 'vitest';
import { isolateForText } from '@/lib/utils/emailText';

const FSI = '\u2068';
const PDI = '\u2069';

describe('isolateForText', () => {
  it('wraps a plain value in a first-strong isolate', () => {
    expect(isolateForText('Birthday')).toBe(`${FSI}Birthday${PDI}`);
  });

  it('strips every bidi embedding, override and isolate inside the value', () => {
    const value = 'a\u202Ab\u202Bc\u202Cd\u202De\u202Ef\u2066g\u2067h\u2068i\u2069j';
    expect(isolateForText(value)).toBe(`${FSI}abcdefghij${PDI}`);
  });

  it('turns line breaks and control characters into a space', () => {
    expect(isolateForText('one\r\ntwo\nthree\u2028four\u2029five\u0000six\u0007')).toBe(
      `${FSI}one two three four five six${PDI}`
    );
    expect(isolateForText('a\u0085b')).toBe(`${FSI}a b${PDI}`);
  });

  it('keeps ZWJ and ZWNJ, emoji and non-Latin text', () => {
    const value = '👩\u200D👩\u200D👧 می\u200Cخواهم';
    expect(isolateForText(value)).toBe(`${FSI}${value}${PDI}`);
  });

  it('is idempotent', () => {
    const once = isolateForText('x\u202Ey\r\nz');
    expect(isolateForText(once)).toBe(once);
  });
});
