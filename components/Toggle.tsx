'use client';

import type { ReactNode } from 'react';

// A labelled on/off switch: the label and description on the left, the switch
// on the right.
export default function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  note,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  /** Beside the label: a setting that saves as it changes says so here (`SaveNote`). */
  note?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          <p className="text-sm font-medium text-foreground">{label}</p>
          {note}
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'bg-primary-600' : 'bg-border-strong'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
