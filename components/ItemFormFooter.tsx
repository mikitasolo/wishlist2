'use client';

import Button from './Button';
import { submitItemFormAs } from './ItemForm';

interface ItemFormFooterProps {
  /** The `formId` of the `ItemForm` these buttons submit (they sit outside it, in a modal's footer). */
  formId: string;
  /** While the form is saving or its item is being deleted: every button is held. */
  busy: boolean;
  /** A photo the form is still waiting for: saving is held (Cancel isn't), see `ItemForm`'s `image`. */
  holdSave?: boolean;
  /** Only a save reads `submittingLabel`; a delete also holds the buttons. */
  saving: boolean;
  onCancel: () => void;
  submitLabel: string;
  submittingLabel: string;
  /** An add's (or a review's) second action: saves the item as a draft. */
  saveAsDraft?: boolean;
  /** The draft action's label ("Save as draft"; a review's "Add as draft"). */
  draftLabel?: string;
  /** Read by the draft action instead of the primary while a draft save runs. */
  draftSubmittingLabel?: string;
  /** Whether the save running is the draft action's (see `draftSubmittingLabel`). */
  savingDraft?: boolean;
  /** An edit's Delete (a review's Decline), a red text button on the left. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** The "Keep adding" checkbox, for a form that clears itself and stays open. */
  keepAdding?: { checked: boolean; onChange: (checked: boolean) => void };
}

// On a phone the buttons share the row's width; from `sm` up they keep their own.
// A label stays on one line, so a review's row of three (Decline, Cancel, Add as
// draft) doesn't break "Add as draft" in two.
const BUTTON_CLASS = 'max-sm:flex-1 max-sm:px-3 whitespace-nowrap';

/**
 * The item dialogs' pinned footer (give it to `BaseModal`'s `footer`): Cancel,
 * then, for an add, Save as draft, then the primary action. Its submit button is
 * the form's default one, so Enter in a field presses it, never the draft button.
 * Delete (an edit) or Decline (a review) sits on the left. "Keep adding" has a line of its own on a
 * phone, where the buttons need the width.
 */
export default function ItemFormFooter({
  formId,
  busy,
  holdSave = false,
  saving,
  onCancel,
  submitLabel,
  submittingLabel,
  saveAsDraft,
  draftLabel = 'Save as draft',
  draftSubmittingLabel,
  savingDraft = false,
  onDelete,
  deleteLabel = 'Delete item',
  keepAdding,
}: ItemFormFooterProps) {
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-3">
      {keepAdding && (
        <label
          className={`flex h-11 cursor-pointer items-center gap-2 text-sm font-medium text-foreground sm:mr-auto ${
            saveAsDraft ? 'basis-full' : 'max-sm:basis-full'
          }`}
        >
          <input
            type="checkbox"
            checked={keepAdding.checked}
            onChange={(e) => keepAdding.onChange(e.target.checked)}
            disabled={busy}
            className="h-4 w-4 cursor-pointer rounded border-border-strong accent-primary-600 disabled:cursor-not-allowed"
          />
          Keep adding
        </label>
      )}
      {onDelete && (
        <Button
          type="button"
          variant="danger-ghost"
          onClick={onDelete}
          disabled={busy}
          className="mr-auto whitespace-nowrap max-sm:px-3"
        >
          {deleteLabel}
        </Button>
      )}
      <Button
        type="button"
        variant="secondary"
        onClick={onCancel}
        disabled={busy}
        className={BUTTON_CLASS}
      >
        Cancel
      </Button>
      {saveAsDraft && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => submitItemFormAs(formId, 'draft')}
          disabled={busy || holdSave}
          className={BUTTON_CLASS}
        >
          {saving && savingDraft && draftSubmittingLabel ? draftSubmittingLabel : draftLabel}
        </Button>
      )}
      <Button
        type="submit"
        form={formId}
        disabled={busy || holdSave}
        className={`${BUTTON_CLASS} ${saveAsDraft ? 'max-sm:basis-full' : ''}`}
      >
        {saving && !(savingDraft && draftSubmittingLabel) ? submittingLabel : submitLabel}
      </Button>
    </div>
  );
}
