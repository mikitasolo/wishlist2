'use client';

import Icon from '@/components/Icon';

/**
 * One tag as a toggle pill (WIS-385), the same in the list's tag chips
 * (`TagChips`) and the item form's tags (`ItemTagsField`): `aria-pressed`, no
 * count. `removable` (the item form) marks a picked tag with a ×, so it reads
 * as one you can take off the item, not just a highlighted chip.
 */
export default function TagToggle({
  tag,
  pressed,
  onClick,
  disabled,
  removable = false,
}: {
  tag: string;
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  removable?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
        pressed
          ? 'border-transparent bg-foreground text-background'
          : 'border-border bg-surface text-foreground hover:bg-surface-hover'
      }`}
    >
      {tag}
      {removable && pressed && <Icon name="close" size={12} className="-mr-1" aria-hidden />}
    </button>
  );
}
