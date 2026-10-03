'use client';

import { ComponentPropsWithRef, ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import {
  iconButtonClassName,
  ICON_BUTTON_ICON_SIZE,
  type ButtonShape,
  type IconButtonSize,
  type IconButtonVariant,
} from '@/components/buttonStyles';

interface IconButtonProps extends Omit<
  ComponentPropsWithRef<'button'>,
  'children' | 'aria-label' | 'aria-labelledby'
> {
  icon: IconName;
  /**
   * The accessible name. Required: the button shows no text, so without it a
   * screen reader would announce just "button".
   */
  label: string;
  /** `xs` (32px) for a close or clear button inline with text; otherwise square at the row's height. */
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** `pill` makes it round. */
  shape?: ButtonShape;
  /** Classes for the icon (its colour, a rotation). */
  iconClassName?: string;
  /** Drawn after the icon, e.g. a count badge. */
  children?: ReactNode;
}

/** An icon-only button, with an 18px icon, sized from the same scale as `Button`. */
export default function IconButton({
  icon,
  label,
  size = 'xs',
  variant = 'ghost',
  shape = 'rounded',
  iconClassName,
  className = '',
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      aria-label={label}
      className={`${iconButtonClassName({ variant, size, shape })} ${className}`}
    >
      <Icon name={icon} size={ICON_BUTTON_ICON_SIZE} className={iconClassName} />
      {children}
    </button>
  );
}
