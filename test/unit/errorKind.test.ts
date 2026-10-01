import { describe, it, expect } from 'vitest';
import { errorKind } from '@/lib/utils/errorKind';

describe('errorKind', () => {
  const failure = Object.assign(new Error('rejected jane.doe@example.com'), {
    name: 'MongoServerError',
    code: 11000,
    responseCode: 550,
  });

  it('keeps the name and code, never the message', () => {
    expect(errorKind(failure)).toEqual({ name: 'MongoServerError', code: 11000 });
    expect(JSON.stringify(errorKind(failure))).not.toContain('jane');
  });

  it('keeps just the fields asked for', () => {
    expect(errorKind(failure, ['name', 'code', 'responseCode'])).toEqual({
      name: 'MongoServerError',
      code: 11000,
      responseCode: 550,
    });
  });

  it('names only the type of something that isn’t an object', () => {
    expect(errorKind('rejected jane.doe@example.com')).toEqual({ name: 'string' });
    expect(errorKind(null)).toEqual({ name: 'object' });
    expect(errorKind(undefined)).toEqual({ name: 'undefined' });
  });
});
