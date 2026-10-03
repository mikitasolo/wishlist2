'use client';

import { ComponentPropsWithRef, ReactNode } from 'react';
import { useFieldControl } from '@/components/Field';
import {
  BOXED_INPUT,
  fieldBoxClassName,
  inputClassName,
  type FieldSize,
} from '@/components/fieldStyles';

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** `lg` (44px, the default) in a form, `sm` (36px) in a toolbar. */
  size?: FieldSize;
  /** Shown inside the field, before the text (a currency symbol, `@`, an icon). */
  leading?: ReactNode;
  /** Shown inside the field, after the text (a status, a clear button). */
  trailing?: ReactNode;
  /**
   * Classes for what draws the field: the input, or with `leading` or
   * `trailing` the box around it.
   */
  className?: string;
}

/**
 * A text field. Inside a `Field` it takes the field's id and descriptions. With
 * `leading` or `trailing` content the border, and the focus ring, move to a box
 * around the input, so they go round what sits beside it too.
 */
export default function Input({
  size = 'lg',
  leading,
  trailing,
  className = '',
  type = 'text',
  ...props
}: InputProps) {
  const control = useFieldControl(props);

  if (leading === undefined && trailing === undefined) {
    return (
      <input
        type={type}
        {...props}
        {...control}
        className={`${inputClassName(size)} ${className}`}
      />
    );
  }

  return (
    <div className={`${fieldBoxClassName(size)} ${className}`}>
      {leading !== undefined && (
        <span className="flex flex-shrink-0 items-center text-muted-foreground">{leading}</span>
      )}
      <input type={type} {...props} {...control} className={BOXED_INPUT} />
      {trailing !== undefined && (
        <span className="flex flex-shrink-0 items-center">{trailing}</span>
      )}
    </div>
  );
}
