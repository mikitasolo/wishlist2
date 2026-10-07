'use client';

import { useState, type FormEvent } from 'react';
import Button from './Button';
import Field from './Field';
import Input from './Input';
import { GROUP_NAME_MAX } from '@/lib/validations';

interface NewGroupFormProps {
  /** Makes the group; resolves to null, or the message to show under the field. */
  onCreate: (name: string) => Promise<string | null>;
  /** Set when no more can be made: the form is held, saying why. */
  atLimit?: string | null;
  /** `sm` inside a dialog's list, `lg` (default) in a settings panel. */
  size?: 'sm' | 'lg';
}

/** A name and Create: a new group (WIS-27), in Settings → Groups and Tag into groups. */
export default function NewGroupForm({ onCreate, atLimit, size = 'lg' }: NewGroupFormProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving || atLimit) return;
    setSaving(true);
    setError(null);
    const failed = await onCreate(trimmed);
    setSaving(false);
    if (failed) setError(failed);
    else setName('');
  }

  return (
    <form onSubmit={submit}>
      <Field label="New group" helper={atLimit ?? undefined} error={error ?? undefined}>
        <div className="flex items-center gap-3">
          <Input
            size={size}
            value={name}
            maxLength={GROUP_NAME_MAX}
            placeholder="e.g. Family"
            disabled={!!atLimit}
            className="min-w-0 flex-1"
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
          />
          <Button
            type="submit"
            size={size}
            variant="secondary"
            icon="plus"
            disabled={!name.trim() || saving || !!atLimit}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </Field>
    </form>
  );
}
