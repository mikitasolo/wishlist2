'use client';

import Button from './Button';
import { submitItemFormAs } from './ItemForm';

interface ItemFormFooterProps {
  /** The `formId` of the `ItemForm` these buttons submit (they sit outside it, in a modal's footer). */
  formId: string;
  /** While the form is saving or its item is being deleted: every button is held. */
  busy: boolean;
  /** Only a save reads `submittingLabel`; a delete also holds the buttons. */
  saving: boolean;
  onCancel: () => void;
  submitLabel: string;
  submittingLabel: string;
  /** An add's second action: saves the new item as a draft. */
  saveAsDraft?: boolean;
  /** An edit's Delete, a red text button on the left. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** The "Keep adding" checkbox, for a form that clears itself and stays open. */
  keepAdding?: { checked: boolean; onChange: (checked: boolean) => void };
}

// On a phone the buttons share the row's width; from `sm` up they keep their own.
const BUTTON_CLASS = 'max-sm:flex-1 max-sm:px-3';

/**
 * The item dialogs' pinned footer (give it to `BaseModal`'s `footer`): Cancel,
 * then, for an add, Save as draft, then the primary action. Its submit button is
 * the form's default one, so Enter in a field presses it, never the draft button.
 * Delete (an edit) sits on the left. "Keep adding" has a line of its own on a
 * phone, where the buttons need the width.
 */
export default function ItemFormFooter({
  formId,
  busy,
  saving,
  onCancel,
  submitLabel,
  submittingLabel,
  saveAsDraft,
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
          className="mr-auto"
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
          disabled={busy}
          className={BUTTON_CLASS}
        >
          Save as draft
        </Button>
      )}
      <Button
        type="submit"
        form={formId}
        disabled={busy}
        className={`${BUTTON_CLASS} ${saveAsDraft ? 'max-sm:basis-full' : ''}`}
      >
        {saving ? submittingLabel : submitLabel}
      </Button>
    </div>
  );
}
