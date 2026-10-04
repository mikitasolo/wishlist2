// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import BrandLink from '@/components/BrandLink';

describe('BrandLink', () => {
  it('is a home link named "Wishlist home" with no tile image', () => {
    const { container } = render(<BrandLink />);
    const link = screen.getByRole('link', { name: 'Wishlist home' });
    expect(link).toHaveAttribute('href', '/');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows the wordmark at every width, with the full stop hidden from assistive tech', () => {
    render(<BrandLink />);
    const link = screen.getByRole('link', { name: 'Wishlist home' });
    expect(link).toHaveTextContent('Wishlist.');
    expect(link.className).not.toMatch(/hidden/);
    const dot = link.querySelector('span');
    expect(dot).toHaveTextContent('.');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot).toHaveClass('text-accent');
  });
});
