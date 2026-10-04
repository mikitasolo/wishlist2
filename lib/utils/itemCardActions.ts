// What an item card offers beyond its status primary, worked out from the
// viewer's role and the item's state alone, so the card's row and anything
// that reuses its actions (an item sheet) read one set. Owners are
// booking-blind: nothing here takes a booking, and an owner is never offered
// a reservation action.

export interface CardActionContext {
  isAuthenticated: boolean;
  isOwner: boolean;
  isMember: boolean;
  /** The item's stored status. */
  status: string;
  /** It's received (shown as completed to this viewer). */
  isCompleted: boolean;
  /** A member's own booking, already marked as given. */
  isGivenByViewer: boolean;
  hasLink: boolean;
  /** The page's handlers, given only where the viewer may use them. */
  canEdit: boolean;
  canSave: boolean;
  canDelete: boolean;
  canAddLink: boolean;
  /** Save to my list is already the row's primary (so the menu doesn't repeat it). */
  primaryIsSave?: boolean;
}

export type CardMenuAction =
  | 'markReceived'
  | 'moveToDraft'
  | 'editDraft'
  | 'mostWanted'
  | 'releaseGiven'
  | 'saveToList'
  | 'decline'
  | 'delete';

/** The "⋯" menu's entries, in order. Empty means no menu. */
export function cardMenuActions(c: CardActionContext): CardMenuAction[] {
  const out: CardMenuAction[] = [];
  if (!c.isAuthenticated) return out;
  const proposed = c.status === 'proposed';
  const draft = c.status === 'draft';
  const published = !proposed && !draft;
  if (c.isOwner && published) {
    out.push('markReceived');
    if (!c.isCompleted) out.push('moveToDraft');
  }
  if (c.isOwner && draft && c.canEdit) out.push('editDraft');
  if (c.isOwner && !proposed) out.push('mostWanted');
  if (c.isMember && c.isGivenByViewer) out.push('releaseGiven');
  if (c.canSave && !c.primaryIsSave) out.push('saveToList');
  if (c.isOwner && c.canDelete) out.push(proposed ? 'decline' : 'delete');
  return out;
}

/** A signed-in non-member's item with no link: Save to my list is the primary. */
export function savesAsPrimary(c: CardActionContext): boolean {
  return !c.hasLink && c.isAuthenticated && !c.isOwner && !c.isMember && c.canSave;
}

export type LinkSlot = 'link' | 'add-link' | 'none';

/**
 * The square beside the primary: the product link, "+ link" for an owner whose
 * item has none, and nothing for anyone else (no dead placeholder).
 */
export function linkSlot(c: CardActionContext): LinkSlot {
  if (c.hasLink) return 'link';
  if (c.isAuthenticated && c.isOwner && c.status !== 'proposed' && c.canAddLink) return 'add-link';
  return 'none';
}
