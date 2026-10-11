// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmptyState from '@/components/EmptyState';
import LoadError from '@/components/LoadError';
import Button from '@/components/Button';

beforeEach(() => cleanup());

/** The icon chip: the span the icon is drawn in. */
const chip = () => document.querySelector('svg')!.parentElement as HTMLElement;

describe('EmptyState', () => {
  it('shows its title as a heading, its body and its actions', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <EmptyState
        icon="gift"
        title="No wishlists yet"
        body="Create your first wishlist."
        actions={<Button onClick={onCreate}>Create wishlist</Button>}
      />
    );
    expect(screen.getByRole('heading', { level: 3, name: 'No wishlists yet' })).toBeInTheDocument();
    expect(screen.getByText('Create your first wishlist.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create wishlist' }));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('leaves out the body and actions it isn’t given', () => {
    render(<EmptyState icon="gift" title="Nothing here yet" />);
    const box = screen.getByRole('heading', { name: 'Nothing here yet' }).parentElement!;
    expect(box.querySelectorAll('p')).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['default', 'text-accent'],
    ['muted', 'text-muted-foreground'],
    ['error', 'text-danger'],
  ] as const)('colours its chip for the %s tone', (tone, colour) => {
    render(<EmptyState icon="lock" title="T" tone={tone} />);
    expect(chip()).toHaveClass(colour);
  });

  it.each([
    ['gift', 'default'],
    ['package', 'muted'],
    ['list', 'default'],
    ['users', 'muted'],
    ['search', 'muted'],
    ['link-off', 'default'],
    ['bell', 'default'],
  ] as const)('draws a spot illustration, not a chip, for the %s icon (%s)', (icon, tone) => {
    render(<EmptyState icon={icon} title="T" tone={tone} />);
    const svg = document.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 96 96');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelectorAll('svg')).toHaveLength(1);
    expect(svg.parentElement).toBe(screen.getByRole('heading').parentElement);
  });

  it('keeps the icon chip for an icon with no illustration, and for the error tone', () => {
    const { rerender } = render(<EmptyState icon="lock" title="T" />);
    expect(chip()).toHaveClass('rounded-2xl');
    rerender(<EmptyState icon="gift" title="T" tone="error" />);
    expect(chip()).toHaveClass('rounded-2xl');
  });

  it('draws a smaller one when compact', () => {
    render(<EmptyState icon="gift" title="T" compact />);
    expect(document.querySelector('svg')).toHaveAttribute('width', '48');
  });

  it('stands in a dashed frame by default, and on the page itself unframed', () => {
    const { rerender } = render(<EmptyState icon="gift" title="T" />);
    const box = () => screen.getByRole('heading', { name: 'T' }).parentElement!;
    expect(box()).toHaveClass('border-dashed');
    rerender(<EmptyState icon="gift" title="T" framed={false} level={1} />);
    expect(box()).not.toHaveClass('border-dashed');
    expect(screen.getByRole('heading', { level: 1, name: 'T' })).toBeInTheDocument();
  });
});

describe('LoadError — the error tone with Try again', () => {
  it('says what couldn’t load, in the error tone, and Try again reads it again', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<LoadError title="Couldn’t load your wishlists" onRetry={onRetry} />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Couldn’t load your wishlists' })
    ).toBeInTheDocument();
    expect(screen.getByText('Check your connection and try again.')).toBeInTheDocument();
    expect(chip()).toHaveClass('text-danger');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
