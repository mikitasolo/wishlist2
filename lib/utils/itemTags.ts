/**
 * Item tags (WIS-385): short labels an owner puts on a list's items ("Books",
 * "Kitchen"), several per item, which everyone who sees the list can filter it
 * by (any of the picked tags matches). Owner-written only, never on a
 * proposal, and never counted: a tag chip carries no number, so it can't tell
 * an owner how many of an item's kind are reserved.
 *
 * Tags are plain strings on the item (`Item.tags`); a list's tags are the ones
 * its items carry. Two spellings that differ only in case or spacing are the
 * same tag, and the list keeps the one it has already (`fitTagsToList`).
 *
 * Pure, so the item form, the filter chips and the routes share one rule.
 */

/** The most tags one item carries. */
export const ITEM_TAGS_MAX = 5;

/** The most different tags one list's items carry between them. */
export const LIST_TAGS_MAX = 20;

/** The longest a tag may be. */
export const ITEM_TAG_LENGTH_MAX = 24;

/** Refused when an item would take the list past `LIST_TAGS_MAX`. */
export const LIST_TAGS_FULL_ERROR = `A list can have up to ${LIST_TAGS_MAX} tags. Use one it already has, or remove one first.`;

/** Answered to anyone but an owner sending tags. */
export const OWNER_ONLY_TAGS_ERROR = 'Only owners can tag items';

/** Refused when an owner tags an item that's still a proposal, without approving it. */
export const PROPOSAL_TAGS_ERROR = 'Add the proposal to the list before tagging it';

/** Sent back with an edit saved without its new tags: the list filled up meanwhile. */
export const TAGS_NOT_KEPT_NOTICE = `Saved, but without the new tags: this list already has ${LIST_TAGS_MAX}.`;

/** Sent back with a new item saved without its tags: the list filled up meanwhile. */
export const TAGS_DROPPED_NOTICE = `Saved without its tags: this list already has ${LIST_TAGS_MAX}.`;

/** A tag as typed, tidied: trimmed, with every run of spaces made one. */
export function normalizeTagName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** What decides whether two tags are the same: case and spacing don't. */
export function tagKey(tag: string): string {
  return normalizeTagName(tag).toLowerCase();
}

/**
 * `tags` tidied (`normalizeTagName`), without empty ones and without repeats
 * (by `tagKey`), each kept as first written, in the order given.
 */
export function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTagName(raw);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Whether two tag lists hold the same tags, whatever their order or case. */
export function sameTags(a: readonly string[], b: readonly string[]): boolean {
  const ka = new Set(a.map(tagKey));
  const kb = new Set(b.map(tagKey));
  return ka.size === kb.size && [...ka].every((key) => kb.has(key));
}

/**
 * The tags `items` carry between them, each once (as first met), in
 * alphabetical order: a list's tag chips, and the form's suggestions.
 */
export function listTags(items: Iterable<{ tags?: readonly string[] | null }>): string[] {
  const tags: string[] = [];
  for (const item of items) tags.push(...(item.tags ?? []));
  return uniqueTags(tags).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Whether `item` is shown with the tag chips `picked` on: any of them matches,
 * and none picked shows everything.
 */
export function matchesTags(
  item: { tags?: readonly string[] | null },
  picked: readonly string[]
): boolean {
  if (!picked.length) return true;
  const keys = new Set(picked.map(tagKey));
  return (item.tags ?? []).some((tag) => keys.has(tagKey(tag)));
}

/**
 * An item's new tags, fitted to the list's: each one the list has already
 * takes the list's spelling, and the item may bring in new ones only while the
 * list stays within `LIST_TAGS_MAX`. `existing` is what the list's other items
 * carry, `current` what this item carries now (none for a new item): its own
 * tags are the list's too, so keeping one is never new, but replacing one
 * frees its place. `addsNew` says whether any tag is new to the list, which is
 * when the write must be re-checked against the cap once it has landed.
 */
export function fitTagsToList(
  existing: readonly string[],
  tags: readonly string[],
  current: readonly string[] = []
): { ok: true; tags: string[]; addsNew: boolean } | { ok: false } {
  const others = new Map<string, string>();
  for (const tag of existing) {
    const key = tagKey(tag);
    if (key && !others.has(key)) others.set(key, normalizeTagName(tag));
  }
  const own = new Set(current.map(tagKey));
  const fitted = uniqueTags(tags).map((tag) => others.get(tagKey(tag)) ?? tag);
  const addsNew = fitted.some((tag) => !others.has(tagKey(tag)) && !own.has(tagKey(tag)));
  const after = new Set([...others.keys(), ...fitted.map(tagKey)]).size;
  // Only a new tag can be refused: one the list has already is always fine,
  // even on a list somehow past the cap, so its tags can still be tidied.
  if (addsNew && after > LIST_TAGS_MAX) return { ok: false };
  return { ok: true, tags: fitted, addsNew };
}

/** How many different tags a list's items carry, from what `Item.distinct('tags')` reads. */
export function countListTags(tags: readonly string[]): number {
  return new Set(tags.map(tagKey).filter(Boolean)).size;
}
