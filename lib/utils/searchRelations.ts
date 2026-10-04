/**
 * What a search result says about the searcher's own relation to it
 * (`GET /api/search`), and nothing else: never anyone else's follows or
 * memberships, and nothing at all to a signed-out searcher.
 *
 * A person is `friend` (you follow each other) or `follows_you` (they follow
 * you and you don't follow back); a list is `owner` (you own it) or `member`
 * (you're on it).
 */
export type PersonRelation = 'friend' | 'follows_you';
export type ListRelation = 'owner' | 'member';

/** The label a result row shows for each relation. */
export const RELATION_LABEL: Record<PersonRelation | ListRelation, string> = {
  friend: 'Friend',
  follows_you: 'Follows you',
  owner: 'Your list',
  member: 'Member',
};
