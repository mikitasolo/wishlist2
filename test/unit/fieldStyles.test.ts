import { describe, expect, it } from 'vitest';
import {
  fieldBoxClassName,
  inputClassName,
  pickerTriggerClassName,
} from '@/components/fieldStyles';
import { buttonClassName } from '@/components/buttonStyles';

describe('field and control styles', () => {
  it('draws a field rounded by default and a pill on request', () => {
    expect(inputClassName('lg')).toContain('rounded-xl');
    expect(fieldBoxClassName('sm', 'pill')).toContain('rounded-full');
    expect(fieldBoxClassName('sm', 'pill')).not.toContain('rounded-xl');
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
