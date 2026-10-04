import type { ComponentProps } from 'react';
import ItemForm from '@/components/ItemForm';
import ItemFormFooter from '@/components/ItemFormFooter';

/**
 * An `ItemForm` with its pinned footer's buttons, as the item modals draw them
 * (the buttons sit outside the form and submit it by its id), for tests of the
 * form alone. Cancel, then Save as draft (a create's or a review's), then the
 * submit button.
 */
export default function ItemFormWithFooter({
  submitLabel = 'Submit',
  submittingLabel = 'Submitting…',
  ...props
}: Omit<ComponentProps<typeof ItemForm>, 'formId'>) {
  const formId = 'item-form-under-test';
  return (
    <>
      <ItemForm {...props} formId={formId} submitLabel={submitLabel} />
      <ItemFormFooter
        formId={formId}
        busy={!!props.isSubmitting}
        saving={!!props.isSubmitting}
        onCancel={props.onCancel}
        submitLabel={submitLabel}
        submittingLabel={submittingLabel}
        saveAsDraft={['create', 'review'].includes(props.mode ?? 'create')}
      />
    </>
  );
}
