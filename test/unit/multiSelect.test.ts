import { describe, it, expect } from 'vitest';
import { multiSelectSummary, plainMultiSelectRule } from '@/lib/utils/multiSelect';
import { statusFilterPicker, toggleStatusFilter, type FilterOption } from '@/lib/utils/itemFilters';

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

describe('statusFilterPicker', () => {
  const statuses: FilterOption[] = ['all', 'draft', 'proposed', 'available', 'completed'];
  const defaults: FilterOption[] = ['draft', 'available', 'proposed'];
  const picker = statusFilterPicker(statuses, defaults);
  const rowValues = picker.options.map((o) => o.value);

  it('has a row per status but All, labelled as the stat cards are, and All as its own row', () => {
    expect(picker.options).toEqual([
      { value: 'draft', label: 'Draft' },
      { value: 'proposed', label: 'Proposed' },
      { value: 'available', label: 'Available' },
      { value: 'completed', label: 'Completed' },
    ]);
    expect(picker.allLabel).toBe('All');
  });

  it('works out a click as toggleStatusFilter does, All included', () => {
    const cases: [FilterOption[], FilterOption | null][] = [
      [['draft'], 'available'],
      [['draft'], 'draft'],
      [['draft', 'proposed', 'available'], 'completed'],
      [[...statuses], null],
      [['draft'], null],
    ];
    for (const [selected, value] of cases) {
      expect(picker.rule.toggle(selected, value, rowValues)).toEqual(
        toggleStatusFilter(selected, value ?? 'all', statuses, defaults)
      );
    }
  });

  it('never leaves the selection empty, going back to the defaults', () => {
    expect(picker.rule.toggle(['draft'], 'draft', rowValues)).toEqual(defaults);
    expect(picker.rule.toggle([...statuses], null, rowValues)).toEqual(defaults);
  });

  it('counts an empty selection, All, or every status as everything', () => {
    expect(picker.rule.isAll([], rowValues)).toBe(true);
    expect(picker.rule.isAll(['all'], rowValues)).toBe(true);
    expect(picker.rule.isAll(['draft', 'proposed', 'available', 'completed'], rowValues)).toBe(
      true
    );
    expect(picker.rule.isAll(['draft'], rowValues)).toBe(false);
  });
});
