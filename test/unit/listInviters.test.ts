import { describe, it, expect } from 'vitest';
import { listInviters } from '@/lib/utils/listInviters';

describe('listInviters', () => {
  it('names one owner, or two, by their handles', () => {
    expect(listInviters(['anna_m'], 1)).toEqual({ handles: ['@anna_m'], singular: true });
    expect(listInviters(['anna_m', 'chloe_r'], 2)).toEqual({
      handles: ['@anna_m', '@chloe_r'],
      singular: false,
    });
  });

  it('says "the owners" for more than two', () => {
    expect(listInviters(['a', 'b', 'c'], 3)).toEqual({ generic: 'the owners', singular: false });
  });

  // regression: a sole owner without a username read "Only people the owner invite".
  it('names nobody when an owner has no username to name them by, with the verb to match', () => {
    expect(listInviters([], 1)).toEqual({ generic: 'the owner', singular: true });
    expect(listInviters(['anna_m'], 2)).toEqual({ generic: 'the owners', singular: false });
    expect(listInviters([], 0)).toEqual({ generic: 'the owners', singular: false });
  });
});
