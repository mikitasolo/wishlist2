import type { GroupGiftAction } from '@/lib/utils/groupGiftClient';
import type { GroupGiftSummary } from '@/lib/utils/groupGiftSummary';

/** The success toast of each group gift action (WIS-362). Names no one. */
export const GROUP_GIFT_TOASTS: Record<GroupGiftAction['type'], string> = {
  start: 'Group gift started. Others on the list can join it.',
  join: 'You joined the group gift',
  pledge: 'Pledge updated',
  leave: 'You left the group gift',
  cancel: 'Group gift cancelled. The item is available again.',
  convert: 'It’s now your reservation alone',
  give: 'Marked as given',
};

/**
 * Leaving a group gift, said with Undo before it's sent (WIS-387), so it says
 * what the leave does as the confirmation it replaces did: the last one out
 * ends it, an organizer hands it on. Names no one.
 */
export function leaveGroupGiftToast(gift: GroupGiftSummary | undefined): string {
  if (!gift?.contributing) return GROUP_GIFT_TOASTS.leave;
  if (gift.contributors.length <= 1) {
    return 'You left, so the group gift has ended. The item is available again.';
  }
  return gift.organizer
    ? 'You left the group gift. The person who joined first is organizer now.'
    : GROUP_GIFT_TOASTS.leave;
}
