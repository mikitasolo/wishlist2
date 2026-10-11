/**
 * Filters lists already read for the viewer to those whose name contains the
 * query (case-insensitive substring, WIS-427). Empty or whitespace-only returns
 * all. A caller's `extraText` must be as public to the viewer as the list's name
 * (the owner's username on Shared with you, which the card shows).
 */
export function searchWishlists<T extends { name?: string | null }>(
  lists: T[],
  query: string,
  extraText?: (list: T) => string | null | undefined
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return lists;
  return lists.filter(
    (l) => l.name?.toLowerCase().includes(q) || extraText?.(l)?.toLowerCase().includes(q)
  );
}
