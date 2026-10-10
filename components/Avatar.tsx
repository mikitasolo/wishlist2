'use client';

import { useState } from 'react';

interface AvatarProps {
  /** Email or display name used to derive initials + color */
  name: string;
  /** Optional profile photo URL. Falls back to initials if missing/broken. */
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

// Deterministic, pleasant gradient pairs keyed off a hash of the identifier.
const palettes = [
  'from-indigo-500 to-violet-500',
  'from-sky-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-fuchsia-500 to-purple-600',
  'from-cyan-500 to-sky-600',
  'from-lime-500 to-green-600',
];

const sizeStyles = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-lg',
};

function initials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return '?';
  // For emails, use the part before @
  const base = cleaned.includes('@') ? cleaned.split('@')[0] : cleaned;
  const parts = base.split(/[.\-_\s]+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return base.slice(0, 2).toUpperCase();
}

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export default function Avatar({ name, src, size = 'md', className = '' }: AvatarProps) {
  const palette = palettes[hash(name) % palettes.length];
  const [broken, setBroken] = useState(false);
  const showImage = !!src && !broken;

  return (
    <span
      className={`relative inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white shadow-sm ${
        showImage ? 'bg-surface-2' : `bg-gradient-to-br ${palette}`
      } ${sizeStyles[size]} ${className}`}
      aria-hidden="true"
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src as string}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
