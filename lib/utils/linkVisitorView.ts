import type { Occasion } from '@/lib/utils/occasion';
import type { Visibility } from '@/lib/utils/visibility';

/**
 * The top of a list as a signed-out share link visitor sees it, read on the
 * server by `/l/[token]` (`linkVisitorView` in `shareLinkPage.ts`, WIS-447) so
 * the page can draw it before its scripts have run. Only what the list's own
 * read answers a link visitor anyway, and nothing about items or reservations.
 */
export interface LinkVisitorView {
  name: string;
  /** The owners' usernames, primary owner first (an owner without one isn't in it). */
  ownerUsernames: string[];
  /** How many owners the list has, usernames or not. */
  ownerCount: number;
  occasion: Occasion | null;
  visibility: Visibility;
  bannerUrl: string | null;
  description: string | null;
}
