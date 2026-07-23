'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'cancel' | 'ghost' | 'soft';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  children: ReactNode;
}

const variantStyles = {
  primary:
    'bg-primary-600 text-white shadow-[0_8px_22px_-10px_rgba(94,92,230,0.9)] hover:bg-primary-500 hover:-translate-y-px hover:shadow-[0_12px_28px_-10px_rgba(94,92,230,0.95)] active:translate-y-0 active:scale-[0.98] disabled:hover:translate-y-0 disabled:hover:bg-primary-600',
  secondary:
    'bg-surface text-foreground border border-border-strong shadow-xs hover:bg-surface-hover active:scale-[0.98] disabled:hover:bg-surface',
  soft: 'bg-primary-500/12 text-accent hover:bg-primary-500/18 active:scale-[0.98] dark:text-primary-300',
  danger:
    'bg-red-500/10 text-red-600 hover:bg-red-500/16 active:scale-[0.98] dark:text-red-400 disabled:hover:bg-red-500/10',
  cancel: 'bg-muted text-foreground hover:bg-surface-2 active:scale-[0.98] disabled:hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted active:scale-[0.98] disabled:hover:bg-transparent',
};

const sizeStyles = {
  sm: 'h-9 px-4 text-sm gap-1.5',
  md: 'h-11 px-5 text-[15px] gap-2',
  lg: 'h-12 px-6 text-base gap-2',
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
    'inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed disabled:active:scale-100';
  const widthStyle = fullWidth ? 'w-full' : '';

  return (
    <button
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${widthStyle} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
