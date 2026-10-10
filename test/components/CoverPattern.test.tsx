// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import Cover, { CoverMonogram } from '@/components/Cover';

describe('Cover: gift-wrap pattern (WIS-397)', () => {
  const bg = (c: HTMLElement) => (c.firstChild as HTMLElement).style.background;

  it('draws a pattern over the gradient when a named cover has no photo', () => {
    const { container } = render(
      <Cover src={null} seed="a" name="Maya" occasionKind="birthday" sizes="64px" />
    );
    expect(bg(container)).toContain('data:image/svg+xml');
    expect(bg(container)).toContain('gradient(');
  });

  it('keeps the plain gradient without a name, and draws none under a photo', () => {
    const plain = render(<Cover src={null} seed="a" sizes="64px" />);
    expect(bg(plain.container)).not.toContain('data:image');
    const photo = render(<Cover src="https://x.test/a.jpg" seed="a" name="Maya" sizes="64px" />);
    expect(bg(photo.container)).toBe('');
  });

  it('shows the monogram initial, and nothing for a name with none', () => {
    expect(render(<CoverMonogram name="  maya" />).container.textContent).toBe('M');
    expect(render(<CoverMonogram name="  " />).container.textContent).toBe('');
  });
});
