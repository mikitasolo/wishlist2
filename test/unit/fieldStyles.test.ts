import { describe, expect, it } from 'vitest';
import {
  fieldBoxClassName,
  inputClassName,
  pickerTriggerClassName,
  textareaClassName,
} from '@/components/fieldStyles';
import { buttonClassName } from '@/components/buttonStyles';

describe('field and control styles', () => {
  it('draws a field rounded by default and a pill on request', () => {
    expect(inputClassName('lg')).toContain('rounded-xl');
    expect(fieldBoxClassName('sm', 'pill')).toContain('rounded-full');
    expect(fieldBoxClassName('sm', 'pill')).not.toContain('rounded-xl');
  });

  // regression: fields were 15px (`lg`) and 14px (`sm`), so iOS browsers
  // zoomed the page in on focus, which needs 16px or more (WIS-352).
  it('types at 16px on a phone, so iOS does not zoom in on focus', () => {
    const fields = (['sm', 'lg'] as const).flatMap((size) => [
      inputClassName(size),
      fieldBoxClassName(size),
      textareaClassName(size),
    ]);
    for (const cls of fields) {
      const classes = cls.split(/\s+/);
      expect(classes).toContain('text-base');
      // No unprefixed size smaller than 16px overrides it on a phone.
      expect(classes.filter((c) => /^text-(xs|sm|body|meta)$/.test(c))).toEqual([]);
    }
    expect(inputClassName('lg')).toContain('sm:text-body');
    expect(inputClassName('sm')).toContain('sm:text-sm');
  });

  it('keeps a picker trigger on the control scale', () => {
    expect(pickerTriggerClassName('sm')).toContain('px-3.5 text-sm');
    expect(pickerTriggerClassName('lg')).toContain('px-3.5 text-body');
  });

  it('gives a picker trigger the field height and focus', () => {
    expect(pickerTriggerClassName('sm')).toContain('h-9');
    expect(pickerTriggerClassName('lg')).toContain('h-11');
    expect(pickerTriggerClassName()).toContain('field-focus');
  });

  it('has the success variants the item card uses', () => {
    expect(buttonClassName({ variant: 'success', size: 'md' })).toContain('bg-success-fill');
    expect(buttonClassName({ variant: 'success-soft', size: 'md' })).toContain('text-success');
  });
});
