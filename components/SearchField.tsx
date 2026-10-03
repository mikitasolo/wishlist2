'use client';

import Icon from '@/components/Icon';
import IconButton from '@/components/IconButton';
import Input, { type InputProps } from '@/components/Input';
import { CONTROL_ICON_SIZE } from '@/components/buttonStyles';

interface SearchFieldProps extends Omit<InputProps, 'leading' | 'trailing'> {
  /** Shows a clear button while there's text, which calls this. */
  onClear?: () => void;
  /** The clear button's accessible name. */
  clearLabel?: string;
}

/**
 * A search field: a text field with a search icon and, while it has text and
 * `onClear` is given, a 32px clear button, which puts focus back in the field.
 * It has no visible label, so give it an `aria-label` (or put it in a `Field`).
 */
export default function SearchField({
  size = 'lg',
  onClear,
  clearLabel = 'Clear search',
  value,
  ...props
}: SearchFieldProps) {
  const hasText = typeof value === 'string' ? value.length > 0 : value != null;
  return (
    <Input
      size={size}
      value={value}
      leading={<Icon name="search" size={CONTROL_ICON_SIZE[size]} />}
      trailing={
        onClear && hasText ? (
          <IconButton
            icon="close"
            label={clearLabel}
            onClick={(e) => {
              // The button goes once the field is empty: focus goes back to the
              // field rather than dropping to <body>.
              const input = e.currentTarget.closest('div')?.querySelector('input');
              onClear();
              input?.focus();
            }}
            shape="pill"
            className="-mr-2"
          />
        ) : undefined
      }
      {...props}
    />
  );
}
