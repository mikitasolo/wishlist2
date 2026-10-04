// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import BaseModal from '@/components/BaseModal';
import LoadError from '@/components/LoadError';

beforeAll(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterAll(() => vi.restoreAllMocks());
beforeEach(() => cleanup());

/** An empty state whose only button opens a dialog; saving removes that button. */
function EmptyPage({ keepOpener = false }: { keepOpener?: boolean }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState(false);
  return (
    <main>
      <h1>My list</h1>
      {(!added || keepOpener) && <button onClick={() => setOpen(true)}>Add your first item</button>}
      <BaseModal isOpen={open} onClose={() => setOpen(false)} title="Add item" titleId="t">
        <button
          onClick={() => {
            setAdded(true);
            setOpen(false);
          }}
        >
          Save
        </button>
      </BaseModal>
    </main>
  );
}

describe('focus when the opener is gone after a dialog closes', () => {
  // regression: the opener was removed by the dialog's own action, so focus
  // dropped to <body> (WIS-287)
  it('lands on the page heading, never <body>', async () => {
    const user = userEvent.setup();
    render(<EmptyPage />);
    await user.click(screen.getByRole('button', { name: 'Add your first item' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: 'Add your first item' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'My list' }));
    expect(document.activeElement).toHaveClass('outline-hidden');
  });

  it('prefers a data-focus-fallback target', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button data-focus-fallback>Add item</button>
        <EmptyPage />
      </>
    );
    await user.click(screen.getByRole('button', { name: 'Add your first item' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await Promise.resolve();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add item' }));
  });

  it('still returns to the opener while it exists', async () => {
    const user = userEvent.setup();
    render(<EmptyPage keepOpener />);
    const opener = screen.getByRole('button', { name: 'Add your first item' });
    await user.click(opener);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await Promise.resolve();
    expect(document.activeElement).toBe(opener);
  });
});

describe('LoadError — Try again', () => {
  function Page({ compact = false }: { compact?: boolean }) {
    const [failed, setFailed] = useState(true);
    return (
      <main>
        <h1>Reserved</h1>
        {failed ? (
          <LoadError title="Couldn’t load" compact={compact} onRetry={() => setFailed(false)} />
        ) : (
          <p>Loading…</p>
        )}
      </main>
    );
  }

  // regression: the panel unmounted the focused button, dropping focus to <body> (WIS-289)
  it('moves focus to the page heading as the panel goes', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Reserved' }));
  });

  it('leaves focus to the dialog when compact', async () => {
    const user = userEvent.setup();
    render(<Page compact />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Reserved' }));
  });
});
