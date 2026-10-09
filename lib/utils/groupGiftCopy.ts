import type { GroupGiftAction } from '@/lib/utils/groupGiftClient';

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
