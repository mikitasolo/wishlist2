'use client';

import { ComponentPropsWithRef, ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import {
  buttonClassName,
  CONTROL_ICON_SIZE,
  type ButtonShape,
  type ButtonSize,
  type ButtonVariant,
} from '@/components/buttonStyles';

interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  /** From the one control scale: sm 36, md 40, lg 44 (the default), xl 48. */
  size?: ButtonSize;
  /** `pill` for page-header actions and other page chrome. */
  shape?: ButtonShape;
  fullWidth?: boolean;
  /** A leading icon, drawn at the size that goes with `size`. */
  icon?: IconName;
  children: ReactNode;
}

/**
 * The app's button. Every labelled button is one of these (or, for a link,
 * `buttonClassName` on the `<Link>`), so sizes, the primary hover, the glow
 * and the disabled look are set in one place. An icon-only button is an
 * `IconButton`. It's `type="button"` unless it says otherwise, so one dropped
 * into a form never submits it by accident: a form's submit button says
 * `type="submit"`.
 */
export default function Button({
  variant = 'primary',
  size = 'lg',
  shape = 'rounded',
  fullWidth = false,
  icon,
  className = '',
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`${buttonClassName({ variant, size, shape, fullWidth })} ${className}`}
      {...props}
    >
      {icon && <Icon name={icon} size={CONTROL_ICON_SIZE[size]} className="flex-shrink-0" />}
      {children}
    </button>
  );
}
