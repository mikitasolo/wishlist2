'use client';

import Icon from '@/components/Icon';
import { tagKey } from '@/lib/utils/itemTags';

/**
 * The tag chips over a list's items (WIS-385): one toggle per tag the viewer's
 * items carry, any number on at once, an item shown when it has any of them.
 * No counts, unlike the status chips: a tag's count could move with a
 * reservation. On a phone the row scrolls sideways, as the status chips do.
 */
export default function TagChips({
  tags,
  picked,
  onToggle,
  className = '',
}: {
  tags: readonly string[];
  picked: readonly string[];
  onToggle: (tag: string) => void;
  className?: string;
}) {
  const on = new Set(picked.map(tagKey));
  return (
    <div
      role="group"
      aria-label="Filter by tag"
      // Room for the focus outline, which the scroll box would clip.
      className={`scrollbar-hide -mx-4 flex items-center gap-2 overflow-x-auto px-4 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 ${className}`}
    >
      <Icon name="tag" size={16} className="flex-shrink-0 text-muted-foreground" aria-hidden />
      {tags.map((tag) => {
        const pressed = on.has(tagKey(tag));
        return (
          <button
            key={tagKey(tag)}
            type="button"
            aria-pressed={pressed}
            onClick={() => onToggle(tag)}
            className={`inline-flex h-8 flex-shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-sm font-medium transition-colors ${
              pressed
                ? 'border-transparent bg-foreground text-background'
                : 'border-border bg-surface text-foreground hover:bg-surface-hover'
            }`}
          >
            {tag}
          </button>
        );
      })}
    </div>
  );
}
