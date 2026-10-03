// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReservedByYouChip from '@/components/ReservedByYouChip';

describe('ReservedByYouChip', () => {
  it('says how many you have reserved', () => {
    render(<ReservedByYouChip count={1} />);
    expect(screen.getByText('1 reserved by you')).toBeInTheDocument();
  });

  it('renders nothing for no reservations, a missing count or a nonsense one', () => {
    for (const count of [0, -1, null, undefined, Number.NaN]) {
      const { container, unmount } = render(<ReservedByYouChip count={count} />);
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});
