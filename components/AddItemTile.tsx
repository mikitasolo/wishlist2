import Icon from '@/components/Icon';

interface AddItemTileProps {
  /** "Add item" (an owner's) or "Propose an item" (a member's); its accessible name too. */
  label: string;
  onClick: () => void;
}

/**
 * The first cell of a list's item grid for someone who can add to it: a dashed
 * tile that opens the same dialog as the header's Add item (or Propose). It
 * fills its grid cell, so it's as wide as a card and as tall as its row: the
 * compact card's on a phone, the full card's from `sm` up. It isn't a link, so
 * it doesn't lift on hover; it tints.
 */
export default function AddItemTile({ label, onClick }: AddItemTileProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-40 min-w-0 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-border-strong p-3 text-center text-accent transition-colors hover:border-primary-500/50 hover:bg-primary-500/6 sm:p-5"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/12 transition-colors group-hover:bg-primary-500/18">
        <Icon name="plus" size={18} />
      </span>
      <span className="text-body font-semibold">{label}</span>
    </button>
  );
}
