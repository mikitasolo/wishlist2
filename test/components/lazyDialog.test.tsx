// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '@/components/ToastProvider';
import { CHUNK_FAILED_MESSAGE, importWithRetry, lazyDialog } from '@/components/lazyDialog';

function Dialog({ onClose }: { onClose: () => void }) {
  return <button onClick={onClose}>Real dialog</button>;
}

function renderLazy(load: () => Promise<{ default: typeof Dialog }>, onClose = vi.fn()) {
  const Lazy = lazyDialog(load);
  render(
    <ToastProvider>
      <Lazy onClose={onClose} />
    </ToastProvider>
  );
  return onClose;
}

describe('lazyDialog', () => {
  it('renders the dialog once its code loads', async () => {
    renderLazy(() => Promise.resolve({ default: Dialog }));
    expect(await screen.findByRole('button', { name: 'Real dialog' })).toBeInTheDocument();
  });

  it('retries a failed import once and then renders the dialog', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('ChunkLoadError'))
      .mockResolvedValue({ default: Dialog });
    renderLazy(load);
    expect(await screen.findByRole('button', { name: 'Real dialog' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });

  // regression: a tab left open across a deploy asks for chunk URLs that 404, and
  // next/dynamic threw that to the error boundary instead of failing gracefully.
  it('shows a Reload toast and closes the dialog when the code never loads', async () => {
    const load = vi.fn().mockRejectedValue(new Error('ChunkLoadError'));
    const reload = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      const onClose = renderLazy(load);
      expect(await screen.findByText(CHUNK_FAILED_MESSAGE)).toBeInTheDocument();
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Real dialog' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(reload).toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: original });
    }
  });

  it('stays silent when quiet', async () => {
    const load = vi.fn().mockRejectedValue(new Error('x'));
    const Lazy = lazyDialog(load, { quiet: true });
    render(
      <ToastProvider>
        <Lazy />
      </ToastProvider>
    );
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.queryByText(CHUNK_FAILED_MESSAGE)).toBeNull();
  });
});

describe('importWithRetry', () => {
  it('gives up after one retry', async () => {
    const load = vi.fn().mockRejectedValue(new Error('x'));
    await expect(importWithRetry(load)).rejects.toThrow('x');
    expect(load).toHaveBeenCalledTimes(2);
  });
});
