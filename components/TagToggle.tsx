'use client';

/**
 * One tag as a toggle pill (WIS-385), the same in the list's tag chips
 * (`TagChips`) and the item form's tags (`ItemTagsField`): `aria-pressed`, no
 * count.
 */
export default function TagToggle({
  tag,
  pressed,
  onClick,
  disabled,
}: {
  tag: string;
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 flex-shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
        pressed
          ? 'border-transparent bg-foreground text-background'
          : 'border-border bg-surface text-foreground hover:bg-surface-hover'
      }`}
    >
      {tag}
    </button>
  );
}
