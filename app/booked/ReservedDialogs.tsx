import ConfirmDialog from '@/components/ConfirmDialog';
import type { useReservedData } from './useReservedData';

type ReservedData = ReturnType<typeof useReservedData>;

/**
 * The confirmation each Mark as given opens (a reservation's, and a group
 * gift's organizer's), confirming into its action from `useReservedData`.
 * Remove, Release, Leave and Delete from history have no confirmation: they
 * offer Undo instead (WIS-387).
 */
export default function ReservedDialogs({
  confirms,
  actions,
}: {
  confirms: ReservedData['confirms'];
  actions: ReservedData['actions'];
}) {
  const {
    gift: giftConfirm,
    setGift: setGiftConfirm,
    groupGive: groupGiveConfirm,
    setGroupGive: setGroupGiveConfirm,
  } = confirms;
  const { markGifted, giveGroupGift } = actions;
  return (
    <>
      {giftConfirm && (
        <ConfirmDialog
          isOpen
          title="Mark as given?"
          message="This adds the item to your gift history. It won’t change the owner’s list — they’ll mark it received themselves. You can remove it from your history later."
          confirmText="Mark as given"
          cancelText="Cancel"
          type="info"
          onConfirm={() => {
            markGifted(giftConfirm);
            setGiftConfirm(null);
          }}
          onCancel={() => setGiftConfirm(null)}
        />
      )}

      {groupGiveConfirm && (
        <ConfirmDialog
          isOpen
          title="Mark the group gift as given?"
          message="Everyone in it gets it in their gift history, with their own share. It won’t change the owner’s list — they’ll mark it received themselves."
          confirmText="Mark as given"
          cancelText="Cancel"
          type="info"
          onConfirm={() => {
            giveGroupGift(groupGiveConfirm);
            setGroupGiveConfirm(null);
          }}
          onCancel={() => setGroupGiveConfirm(null)}
        />
      )}
    </>
  );
}
