import { describe, it, expect } from 'vitest';
import { multiSelectSummary, plainMultiSelectRule } from '@/lib/utils/multiSelect';

const values = ['a', 'b', 'c'];
const options = values.map((v) => ({ value: v, label: v.toUpperCase() }));

describe('plainMultiSelectRule', () => {
  const rule = plainMultiSelectRule();

  it('ticks and unticks the value clicked', () => {
    expect(rule.toggle(['a'], 'b', values)).toEqual(['a', 'b']);
    expect(rule.toggle(['a', 'b'], 'a', values)).toEqual(['b']);
    // It can end up empty.
    expect(rule.toggle(['a'], 'a', values)).toEqual([]);
  });

  it('selects everything with All, and nothing once everything is', () => {
    expect(rule.toggle(['a'], null, values)).toEqual(values);
    expect(rule.toggle([], null, values)).toEqual(values);
    expect(rule.toggle(['c', 'a', 'b'], null, values)).toEqual([]);
  });

  it('counts every value selected as everything, but not an empty selection', () => {
    expect(rule.isAll(['c', 'b', 'a'], values)).toBe(true);
    expect(rule.isAll(['a', 'b'], values)).toBe(false);
    expect(rule.isAll([], values)).toBe(false);
    expect(rule.isAll([], [])).toBe(false);
  });
});

describe('multiSelectSummary', () => {
  it('says All, None selected, the one label, or how many', () => {
    expect(multiSelectSummary(values, options, true, 'All lists')).toBe('All lists');
    expect(multiSelectSummary([], options, false, 'All')).toBe('None selected');
    expect(multiSelectSummary(['b'], options, false, 'All')).toBe('B');
    expect(multiSelectSummary(['zz'], options, false, 'All')).toBe('1 selected');
    expect(multiSelectSummary(['a', 'c'], options, false, 'All')).toBe('2 selected');
  });

  it('says All for an empty selection the rule counts as everything', () => {
    expect(multiSelectSummary([], options, true, 'All')).toBe('All');
  });
});
