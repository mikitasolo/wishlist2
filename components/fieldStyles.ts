/**
 * The look of a text field, as class strings, on the same scale as the
 * buttons (`buttonStyles.ts`): `lg` (44px) for every form field, `sm` (36px)
 * for a toolbar or filter bar. A plain module, so a field-like control that
 * isn't an `Input` (a custom picker's trigger) can match it.
 *
 * Focus is `field-focus` (`app/globals.css`) with `outline-hidden`: the border
 * takes the ring colour, with a soft halo. It goes on whatever draws the
 * field's border: the input itself, or the wrapper around a borderless input
 * with something beside it (a prefix, an icon, a clear button).
 */

export type FieldSize = 'sm' | 'lg';

const BORDER =
  'border border-border-strong bg-surface text-foreground outline-hidden field-focus disabled:cursor-not-allowed';

export type FieldShape = 'rounded' | 'pill';

/** `rounded-xl` by default; `pill` for a field that sits in page chrome (the header's search). */
const SHAPE: Record<FieldShape, string> = { rounded: 'rounded-xl', pill: 'rounded-full' };

/**
 * What you type in a field is 16px on a phone: iOS browsers (all WebKit,
 * Chrome too) zoom the page in when a field under 16px is focused, and it
 * stays zoomed. From `sm` up it's back on the control scale (WIS-352).
 */
const FIELD_TEXT: Record<FieldSize, string> = {
  sm: 'text-base sm:text-sm',
  lg: 'text-base sm:text-body',
};

const inputSizeStyles: Record<FieldSize, string> = {
  sm: `h-9 px-3 ${FIELD_TEXT.sm}`,
  lg: `h-11 px-3.5 ${FIELD_TEXT.lg}`,
};

const textareaSizeStyles: Record<FieldSize, string> = {
  sm: `px-3 py-2 ${FIELD_TEXT.sm}`,
  lg: `px-3.5 py-2.5 ${FIELD_TEXT.lg}`,
};

/** A picker trigger is a button, which doesn't zoom, so it keeps the control scale. */
const pickerSizeStyles: Record<FieldSize, string> = {
  sm: 'h-9 px-3.5 text-sm',
  lg: 'h-11 px-3.5 text-body',
};

/** A plain text input. */
export function inputClassName(size: FieldSize = 'lg', shape: FieldShape = 'rounded'): string {
  return `${SHAPE[shape]} ${BORDER} w-full ${inputSizeStyles[size]}`;
}

/** A textarea. */
export function textareaClassName(size: FieldSize = 'lg'): string {
  return `${SHAPE.rounded} ${BORDER} w-full ${textareaSizeStyles[size]}`;
}

/** The box that draws a field's border around a borderless input and what sits beside it. */
export function fieldBoxClassName(size: FieldSize = 'lg', shape: FieldShape = 'rounded'): string {
  return `${SHAPE[shape]} ${BORDER} flex w-full items-center gap-2 has-[input:disabled]:cursor-not-allowed ${inputSizeStyles[size]}`;
}

/** The borderless input inside `fieldBoxClassName`. */
export const BOXED_INPUT =
  'h-full min-w-0 flex-1 border-0 bg-transparent outline-hidden disabled:cursor-not-allowed';

/** A form field's label, above it. */
export const FIELD_LABEL = 'mb-1.5 block text-sm font-medium text-foreground';

/** A field's helper text, under it. */
export const FIELD_HELPER = 'mt-1.5 text-xs text-muted-foreground';

/** A field's error, under it. */
export const FIELD_ERROR = 'mt-1.5 text-xs text-danger';

/**
 * A field-like trigger that opens a popup (`Select`'s, the filter dropdowns'):
 * a field's border and focus, at the field's height, with a medium-weight
 * label and a hover.
 */
export function pickerTriggerClassName(size: FieldSize = 'lg'): string {
  return `flex items-center justify-between gap-2 ${SHAPE.rounded} ${BORDER} ${pickerSizeStyles[size]} font-medium transition-colors hover:bg-surface-hover disabled:opacity-50`;
}
