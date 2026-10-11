import { usernameQuery } from '@/lib/utils/searchQuery';

/** What a Reserved row is searched by: only what the row itself shows. */
export interface ReservedSearchable {
  itemName: string;
  /** The list's name, `null` when the row has none. */
  listName: string | null;
  /** The person's public handle (shown as `@username`), never an email. */
  username: string | null;
}

/**
 * Whether a Reserved row matches the search (WIS-424): the query is a
 * case-insensitive substring of the item's name or the list's name (as typed),
 * or of the person's username (a leading `@` allowed, as in every people
 * search). A blank query matches everything. A query that's only an `@`
 * matches no person (an empty pattern would match every username).
 */
export function matchesReservedSearch(row: ReservedSearchable, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (row.itemName.toLowerCase().includes(q)) return true;
  if (row.listName?.toLowerCase().includes(q)) return true;
  const person = usernameQuery(query);
  return person !== '' && !!row.username && row.username.toLowerCase().includes(person);
}
