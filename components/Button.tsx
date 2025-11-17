'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'cancel' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children: ReactNode;
}

const variantStyles = {
  primary: 'bg-primary-600 text-white hover:bg-primary-700 disabled:hover:bg-primary-600',
  secondary: 'border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:hover:bg-transparent',
  danger: 'text-red-600 hover:bg-red-50 border border-red-200 hover:border-red-300 disabled:hover:bg-transparent disabled:hover:border-red-200',
  cancel: 'bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:hover:bg-gray-100',
  ghost: 'text-gray-700 hover:bg-gray-100 disabled:hover:bg-transparent',
};

const sizeStyles = {
  sm: 'h-8 px-3 py-1.5 text-sm',
  md: 'h-10 px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  const baseStyles =
    'rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
  const widthStyle = fullWidth ? 'w-full' : '';
  const variantStyle = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <button
      className={`${baseStyles} ${variantStyle} ${sizeStyle} ${widthStyle} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

