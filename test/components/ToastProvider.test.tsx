// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ToastProvider, useToast } from '@/components/ToastProvider';

function Trigger() {
  const { showToast } = useToast();
  return (
    <button onClick={() => showToast('Saved successfully', 'success')}>fire</button>
  );
}

beforeEach(() => cleanup());

describe('ToastProvider', () => {
  it('shows a toast on demand and dismisses it', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('fire'));
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));
    expect(screen.queryByText('Saved successfully')).toBeNull();
  });

  // Regression: toast content was top-aligned; it should be vertically centered.
  it('regression: toast row is vertically centered', () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>
    );
    fireEvent.click(screen.getByText('fire'));
    const toast = screen.getByRole('status');
    expect(toast.className).toContain('items-center');
    expect(toast.className).not.toContain('items-start');
  });
});
