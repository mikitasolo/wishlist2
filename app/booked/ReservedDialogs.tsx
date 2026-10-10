import ConfirmDialog from '@/components/ConfirmDialog';
import { leaveGroupGiftMessage } from '@/components/ReservedGroupGift';
import type { Reservation } from './types';
import type { useReservedData } from './useReservedData';

type ReservedData = ReturnType<typeof useReservedData>;

/**
 * The confirmation each card action opens: Mark as given, Remove (dismiss),
 * Release, the group gift's Mark as given and Leave, and Delete from history.
 * Each confirms into its action from `useReservedData` and closes.
 */
export default function ReservedDialogs({
  reservations,
  confirms,
  actions,
}: {
  reservations: Reservation[];
  confirms: ReservedData['confirms'];
  actions: ReservedData['actions'];
}) {
  const {
    gift: giftConfirm,
    setGift: setGiftConfirm,
    dismiss: dismissConfirm,
    setDismiss: setDismissConfirm,
    release: releaseConfirm,
    setRelease: setReleaseConfirm,
    groupGive: groupGiveConfirm,
    setGroupGive: setGroupGiveConfirm,
    leave: leaveConfirm,
    setLeave: setLeaveConfirm,
    deleteGift: deleteGiftConfirm,
    setDeleteGift: setDeleteGiftConfirm,
  } = confirms;
  const { markGifted, dismiss, release, giveGroupGift, leaveGroupGift, deleteGift } = actions;
  const leavingGift = leaveConfirm
    ? reservations.find((x) => x._id === leaveConfirm)?.groupGift
    : undefined;
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

      {dismissConfirm && (
        <ConfirmDialog
          isOpen
          title="Remove from reservations?"
          message="This removes it from your list without adding it to your gift history. It won’t change the owner’s list."
          confirmText="Remove"
          cancelText="Cancel"
          type="warning"
          onConfirm={() => {
            dismiss(dismissConfirm);
            setDismissConfirm(null);
          }}
          onCancel={() => setDismissConfirm(null)}
        />
      )}

      {releaseConfirm && (
        <ConfirmDialog
          isOpen
          title="Release this gift?"
          message="Others on the list will be able to reserve it."
          confirmText="Release"
          cancelText="Cancel"
          type="warning"
          onConfirm={() => {
            release(releaseConfirm);
            setReleaseConfirm(null);
          }}
          onCancel={() => setReleaseConfirm(null)}
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

      {leaveConfirm && (
        <ConfirmDialog
          isOpen
          title="Leave this group gift?"
          message={
            leavingGift ? leaveGroupGiftMessage(leavingGift) : 'Your share comes off the total.'
          }
          confirmText="Leave"
          cancelText="Cancel"
          type="warning"
          onConfirm={() => {
            leaveGroupGift(leaveConfirm);
            setLeaveConfirm(null);
          }}
          onCancel={() => setLeaveConfirm(null)}
        />
      )}

      {deleteGiftConfirm && (
        <ConfirmDialog
          isOpen
          title="Delete from gift history?"
          message="This permanently removes this entry from your gift history."
          confirmText="Delete"
          cancelText="Cancel"
          type="danger"
          onConfirm={() => {
            deleteGift(deleteGiftConfirm);
            setDeleteGiftConfirm(null);
          }}
          onCancel={() => setDeleteGiftConfirm(null)}
        />
      )}
    </>
  );
}
