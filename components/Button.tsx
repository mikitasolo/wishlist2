'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';
import { buttonClassName, type ButtonSize, type ButtonVariant } from '@/components/buttonStyles';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  children: ReactNode;
}

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${buttonClassName({ variant, size, fullWidth })} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
