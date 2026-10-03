'use client';

import { ComponentPropsWithRef } from 'react';
import { useFieldControl } from '@/components/Field';
import { textareaClassName, type FieldSize } from '@/components/fieldStyles';

interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  /** `lg` (the default) in a form, `sm` in a toolbar. */
  size?: FieldSize;
}

/** A multi-line text field. Inside a `Field` it takes the field's id and descriptions. */
export default function Textarea({ size = 'lg', className = '', ...props }: TextareaProps) {
  const control = useFieldControl(props);
  return <textarea {...props} {...control} className={`${textareaClassName(size)} ${className}`} />;
}
