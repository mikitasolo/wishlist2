// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, act, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ComponentProps, type FormEvent } from 'react';
import BaseModal, { type ModalSize } from '@/components/BaseModal';
import Button from '@/components/Button';
import { emulateFocusFixup } from '../focusFixup';

// useBodyScrollLock restores the scroll position on close; jsdom lacks scrollTo.
beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

type ModalProps = Partial<ComponentProps<typeof BaseModal>>;

/** A page with the button that opens the modal, and another one behind it. */
function ModalPage(props: ModalProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <button>Behind</button>
      <BaseModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Edit item"
        titleId="edit-item-title"
        {...props}
      >
        {props.children ?? <input aria-label="Item name" />}
      </BaseModal>
    </>
  );
}

const button = (name: string) => screen.getByRole('button', { name });
const modal = () => screen.getByRole('dialog', { name: 'Edit item' });

async function openModal(props: ModalProps = {}) {
  const user = userEvent.setup();
  render(<ModalPage {...props} />);
  await user.click(button('Open'));
  return user;
}

describe('BaseModal — sizes', () => {
  it.each([
    ['sm', 'max-w-sm'],
    ['md', 'max-w-md'],
    ['lg', 'max-w-lg'],
  ] as [ModalSize, string][])('is %s wide (%s)', async (size, width) => {
    await openModal({ size });
    expect(modal()).toHaveClass(width);
  });

  it('is lg wide by default', async () => {
    await openModal();
    expect(modal()).toHaveClass('max-w-lg');
    expect(modal()).not.toHaveClass('max-w-sm', 'max-w-md');
  });
});

describe('BaseModal — the header', () => {
  it('names the dialog by its title, with a close button named by closeLabel', async () => {
    await openModal({ closeLabel: 'Cancel' });
    expect(within(modal()).getByRole('heading', { name: 'Edit item' })).toBeInTheDocument();
    expect(button('Cancel')).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Close modal' })).toBeNull();
  });

  it('pins headerContent under the title, after the close button in Tab order', async () => {
    const user = await openModal({ headerContent: <button>Followers</button> });
    expect(button('Close modal')).toHaveFocus();
    await user.tab();
    expect(button('Followers')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Item name')).toHaveFocus();
  });
});

describe('BaseModal — the footer', () => {
  const footer = (
    <>
      <Button variant="secondary">Cancel</Button>
      <Button>Save</Button>
    </>
  );

  it('is pinned outside the scrolling body, Cancel then the primary action', async () => {
    await openModal({ footer });
    const field = screen.getByLabelText('Item name');
    const cancel = button('Cancel');
    const bar = cancel.parentElement!;
    // Not inside the body that scrolls, which holds the content.
    expect(bar).not.toContainElement(field);
    expect(field.parentElement).not.toContainElement(cancel);
    expect(bar).toHaveClass('justify-end');
    expect(Array.from(bar.children).map((el) => el.textContent)).toEqual(['Cancel', 'Save']);
  });

  it('is in the Tab order after the body, and Tab wraps from its last button to the close button', async () => {
    const user = await openModal({ footer });
    expect(button('Close modal')).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText('Item name')).toHaveFocus();
    await user.tab();
    expect(button('Cancel')).toHaveFocus();
    await user.tab();
    expect(button('Save')).toHaveFocus();
    await user.tab();
    expect(button('Close modal')).toHaveFocus();
    await user.tab({ shift: true });
    expect(button('Save')).toHaveFocus();
  });

  it('has no footer bar when it has no footer', async () => {
    await openModal();
    expect(within(modal()).queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(modal().querySelector('.border-t')).toBeNull();
  });
});

describe('BaseModal — a form with its submit button in the footer', () => {
  // A disabled control drops focus to <body>, as in a browser.
  beforeEach(() => emulateFocusFixup());

  /** A save that stays in flight until the test fails it. */
  function SavingPage({ onSave }: { onSave: () => Promise<void> }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const submit = async (e: FormEvent) => {
      e.preventDefault();
      setSaving(true);
      try {
        await onSave();
      } catch {
        /* stays open */
      } finally {
        setSaving(false);
      }
    };
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <BaseModal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Edit item"
          titleId="edit-item-title"
          onSubmit={submit}
          isSubmitting={saving}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                Save
              </Button>
            </>
          }
        >
          <input aria-label="Item name" disabled={saving} />
          <input aria-label="Notes" disabled={saving} />
        </BaseModal>
      </>
    );
  }

  function deferredSave() {
    let reject!: () => void;
    const onSave = vi.fn(
      () =>
        new Promise<void>((_, r) => {
          reject = () => r(new Error('failed'));
        })
    );
    return { onSave, fail: () => act(async () => reject()) };
  }

  it('makes the panel the form, so Enter in a field submits it', async () => {
    const { onSave } = deferredSave();
    const user = userEvent.setup();
    render(<SavingPage onSave={onSave} />);
    await user.click(button('Open'));
    expect(modal().tagName).toBe('FORM');

    await user.click(screen.getByLabelText('Notes'));
    await user.keyboard('{Enter}');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("holds focus on the panel while it saves from the footer's submit, then hands it back", async () => {
    const { onSave, fail } = deferredSave();
    const user = userEvent.setup();
    render(<SavingPage onSave={onSave} />);
    await user.click(button('Open'));

    await user.click(button('Save'));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(button('Save')).toBeDisabled();
    expect(button('Close modal')).toBeDisabled();
    expect(modal()).toHaveFocus();
    await user.tab();
    expect(modal()).toHaveFocus();

    await fail();
    expect(button('Save')).toBeEnabled();
    expect(button('Save')).toHaveFocus();
  });
});

describe('BaseModal — busy, and the backdrop', () => {
  beforeEach(() => emulateFocusFixup());

  /** A modal whose Crop button is disabled while it works, with every way out still open. */
  function BusyPage({ closeOnBackdrop }: { closeOnBackdrop?: boolean }) {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <BaseModal
          isOpen={open}
          onClose={() => setOpen(false)}
          title="Edit item"
          titleId="edit-item-title"
          busy={busy}
          closeOnBackdrop={closeOnBackdrop}
          footer={
            <Button onClick={() => setBusy(true)} disabled={busy}>
              Crop
            </Button>
          }
        >
          <p>Content</p>
        </BaseModal>
      </>
    );
  }

  it('holds focus on the panel while busy, leaving the close button and Escape working', async () => {
    const user = userEvent.setup();
    render(<BusyPage />);
    await user.click(button('Open'));
    await user.click(button('Crop'));
    expect(button('Crop')).toBeDisabled();
    expect(modal()).toHaveFocus();
    expect(button('Close modal')).toBeEnabled();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button('Open')).toHaveFocus();
  });

  it('closes on a backdrop click by default', async () => {
    const user = userEvent.setup();
    render(<BusyPage />);
    await user.click(button('Open'));
    await user.click(modal().parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('stays open on a backdrop click with closeOnBackdrop off', async () => {
    const user = userEvent.setup();
    render(<BusyPage closeOnBackdrop={false} />);
    await user.click(button('Open'));
    await user.click(modal().parentElement!);
    expect(modal()).toBeInTheDocument();
    await user.click(button('Close modal'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
