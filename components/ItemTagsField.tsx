'use client';

import { useId, useState, type KeyboardEvent } from 'react';
import Button from '@/components/Button';
import Input from '@/components/Input';
import TagToggle from '@/components/TagToggle';
import { FIELD_ERROR, FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';
import {
  ITEM_TAG_LENGTH_MAX,
  ITEM_TAGS_MAX,
  LIST_TAGS_MAX,
  normalizeTagName,
  tagKey,
  uniqueTags,
} from '@/lib/utils/itemTags';
import { nameCharacterProblem } from '@/lib/utils/visibleName';

/** The note under the tags: what they're for, or that the item has all it can. */
export function tagsFieldNote(picked: number): string {
  return picked >= ITEM_TAGS_MAX
    ? `That's ${ITEM_TAGS_MAX}, the most an item can have`
    : `Everyone who can see the list can filter it by tag. Up to ${ITEM_TAGS_MAX}.`;
}

/**
 * Tags in an owner's add and edit item dialogs (WIS-385): the list's tags as
 * toggles, ticked ones on the item, and a field for a new one (Enter or Add).
 * At most `ITEM_TAGS_MAX` on the item, and a new one only while the list stays
 * within `LIST_TAGS_MAX`; the server holds both caps, and fits a tag the list
 * has in another case to the list's spelling.
 */
export default function ItemTagsField({
  options,
  selected,
  onChange,
  disabled,
}: {
  /** The tags the list's items carry (`listTags`). */
  options: readonly string[];
  /** The item's tags, as picked. */
  selected: readonly string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pickedKeys = new Set(selected.map(tagKey));
  // The list's tags, and any new one picked here, each once.
  const shown = uniqueTags([...options, ...selected]);
  const full = selected.length >= ITEM_TAGS_MAX;

  function toggle(tag: string) {
    setError(null);
    if (pickedKeys.has(tagKey(tag))) {
      onChange(selected.filter((t) => tagKey(t) !== tagKey(tag)));
    } else if (!full) {
      onChange([...selected, tag]);
    }
  }

  function add() {
    const tag = normalizeTagName(draft);
    if (!tag) return;
    const problem = nameCharacterProblem(tag);
    if (problem) {
      setError(problem.replace(/^Name/, 'A tag'));
      return;
    }
    if (tag.length > ITEM_TAG_LENGTH_MAX) {
      setError(`A tag must be ${ITEM_TAG_LENGTH_MAX} characters or less`);
      return;
    }
    const known = shown.find((t) => tagKey(t) === tagKey(tag));
    if (!known && uniqueTags([...options, ...selected]).length >= LIST_TAGS_MAX) {
      setError(`This list has ${LIST_TAGS_MAX} tags, the most it can have. Use one of them.`);
      return;
    }
    setError(null);
    setDraft('');
    // One it has already, in another case, is the list's spelling.
    const spelled = known ?? tag;
    if (!pickedKeys.has(tagKey(spelled)) && !full) onChange([...selected, spelled]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Enter adds a typed tag rather than submitting the form (an empty field
    // leaves Enter to submit it, as in any other field); so does a comma.
    if ((e.key === 'Enter' && normalizeTagName(draft)) || e.key === ',') {
      e.preventDefault();
      add();
    }
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className={FIELD_LABEL}>
        Tags
      </span>
      {shown.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {shown.map((tag) => {
            const on = pickedKeys.has(tagKey(tag));
            return (
              <TagToggle
                key={tagKey(tag)}
                tag={tag}
                pressed={on}
                disabled={disabled || (!on && full)}
                onClick={() => toggle(tag)}
              />
            );
          })}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={`${id}-input`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          placeholder="New tag"
          aria-label="New tag"
          aria-describedby={`${id}-note${error ? ` ${id}-error` : ''}`}
          aria-invalid={error ? true : undefined}
          maxLength={ITEM_TAG_LENGTH_MAX + 8}
          disabled={disabled || full}
          autoComplete="off"
        />
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={add}
          disabled={disabled || full || !normalizeTagName(draft)}
          className="flex-shrink-0"
        >
          Add
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} className={FIELD_ERROR}>
          {error}
        </p>
      )}
      <p id={`${id}-note`} className={FIELD_HELPER}>
        {tagsFieldNote(selected.length)}
      </p>
    </div>
  );
}
