/**
 * How `MultiSelectDropdown` (a checkbox list under an "All" row) works out its
 * selection: the plain rule ticks and unticks what's clicked.
 */

export interface MultiSelectOption<V extends string = string> {
  value: V;
  label: string;
}

export interface MultiSelectRule<V extends string = string> {
  /** Whether `selected` counts as everything: the All row is ticked, and the trigger says so. */
  isAll(selected: V[], values: V[]): boolean;
  /** The selection once the row for `value` (`null`: All) is ticked or unticked. */
  toggle(selected: V[], value: V | null, values: V[]): V[];
}

/** Every option is selected (and there is one). */
const everySelected = <V extends string>(selected: V[], values: V[]) =>
  values.length > 0 && values.every((v) => selected.includes(v));

/**
 * Each row ticks or unticks its own value. All selects every value, or none
 * once they all are, so a selection can be empty ("None selected").
 */
export function plainMultiSelectRule<V extends string = string>(): MultiSelectRule<V> {
  return {
    isAll: everySelected,
    toggle(selected, value, values) {
      if (value === null) return everySelected(selected, values) ? [] : [...values];
      return selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
    },
  };
}

/**
 * What the trigger says: the All label for everything, "None selected", the
 * one option's label, or how many are selected.
 */
export function multiSelectSummary<V extends string>(
  selected: V[],
  options: MultiSelectOption<V>[],
  isAll: boolean,
  allLabel: string
): string {
  if (isAll) return allLabel;
  if (selected.length === 0) return 'None selected';
  if (selected.length === 1) {
    return options.find((o) => o.value === selected[0])?.label ?? '1 selected';
  }
  return `${selected.length} selected`;
}
