'use client';

import { createContext, ReactNode, useContext, useId } from 'react';
import { FIELD_ERROR, FIELD_HELPER, FIELD_LABEL } from '@/components/fieldStyles';

interface FieldControl {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldControl | null>(null);

/** What a control's own props become inside a `Field`: its id, description and validity. */
export function useFieldControl(props: {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}) {
  const field = useContext(FieldContext);
  const describedBy =
    [props['aria-describedby'], field?.describedBy].filter(Boolean).join(' ') || undefined;
  return {
    id: props.id ?? field?.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field?.invalid ? true : undefined),
  };
}

interface FieldProps {
  label: ReactNode;
  /** The control's id; one is made up otherwise. */
  id?: string;
  /** Shown under the control, and read with it. */
  helper?: ReactNode;
  /** Shown under the control, read with it, and marks it invalid. */
  error?: ReactNode;
  className?: string;
  /** The control: an `Input`, `Textarea` or `SearchField`, which pick up the label and descriptions. */
  children: ReactNode;
}

/**
 * A labelled form field: the label above its control, then its helper text
 * and error. The control inside (an `Input`, `Textarea` or `SearchField`, at
 * any depth) takes the field's id, so the label names it, and is described by
 * the helper and the error (`aria-describedby`), and marked `aria-invalid`
 * while there's an error.
 */
export default function Field({ label, id, helper, error, className, children }: FieldProps) {
  const fallbackId = useId();
  const controlId = id ?? fallbackId;
  const helperId = helper ? `${controlId}-helper` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={className}>
      <label htmlFor={controlId} className={FIELD_LABEL}>
        {label}
      </label>
      <FieldContext.Provider value={{ id: controlId, describedBy, invalid: !!error }}>
        {children}
      </FieldContext.Provider>
      {helper && (
        <p id={helperId} className={FIELD_HELPER}>
          {helper}
        </p>
      )}
      {error && (
        <p id={errorId} className={FIELD_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
