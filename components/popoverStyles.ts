/**
 * The one look of every popover: `Select`'s options, `Menu`, the multi-select
 * filter, and the search and invite results. A plain module, like
 * `buttonStyles`, so any component can use it.
 *
 * The surface is `rounded-xl` with `p-1.5`, and its rows are inset in it,
 * `rounded-lg`, highlighted with `bg-muted`. An option row (a choice in a
 * list: Select, a checkbox, a search result) is 36px; an action row (Menu)
 * is 40px.
 */

/** The popover's box: border, surface, padding and shadow. Position it yourself. */
export const POPOVER_SURFACE = 'rounded-xl border border-border bg-surface p-1.5 shadow-lg';

const ROW = 'flex w-full items-center gap-2.5 rounded-lg px-3 text-left text-sm font-medium';

/** A choice in a list (36px): an option, a checkbox, a search result. Add its highlight. */
export const POPOVER_OPTION_ROW = `${ROW} py-2`;

/** An action in a menu (40px). Add its highlight. */
export const POPOVER_ACTION_ROW = `${ROW} py-2.5`;

/** A line of text in place of rows: "Searching…", "No matches". */
export const POPOVER_NOTE = 'px-3 py-2.5 text-sm text-muted-foreground';

/** A heading over a group of rows ("People", "Wishlists"). */
export const POPOVER_GROUP_LABEL =
  'px-3 pb-1 pt-2 text-badge font-semibold uppercase tracking-wider text-muted-foreground';

/** A rule between groups, edge to edge across the surface's padding. */
export const POPOVER_SEPARATOR = '-mx-1.5 my-1.5 border-t border-border';

/** Icons in a row. */
export const POPOVER_ICON_SIZE = 16;
