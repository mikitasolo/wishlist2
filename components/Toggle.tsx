'use client';

import type { ReactNode } from 'react';
import Switch from '@/components/Switch';

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
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
