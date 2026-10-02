// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import OccasionLabel from '@/components/OccasionLabel';
import { formatCalendarDate, type Occasion } from '@/lib/utils/occasion';

// As stored: a yearly occasion's year is the placeholder, which must never show.
const BIRTHDAY: Occasion = { kind: 'birthday', date: '2000-10-14', recurrence: 'yearly' };
const PLACEHOLDER_YEAR = '2000';

/** Local noon on a day, so the local date is that day in any time zone. */
const localNoon = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

beforeEach(() => {
  cleanup();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(localNoon(2026, 10, 2));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('OccasionLabel', () => {
  it('renders nothing for a list without an occasion', () => {
    const { container } = render(<OccasionLabel occasion={null} />);
    expect(container).toBeEmptyDOMElement();
    render(<OccasionLabel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('counts down from the local date to the next occurrence, with the date in its tooltip', () => {
    render(<OccasionLabel occasion={BIRTHDAY} />);
    const label = screen.getByText('Birthday · in 12 days');
    expect(label.tagName).toBe('TIME');
    expect(label).toHaveAttribute('dateTime', '2026-10-14');
    expect(label.parentElement).toHaveAttribute('title', formatCalendarDate('2026-10-14'));
  });

  it("never renders a yearly occasion's placeholder year, in its text or its attributes", () => {
    for (const day of [2, 13, 14, 15]) {
      vi.setSystemTime(localNoon(2026, 10, day));
      const { container, unmount } = render(<OccasionLabel occasion={BIRTHDAY} />);
      expect(container.innerHTML).not.toContain(PLACEHOLDER_YEAR);
      unmount();
    }
    // Not even for a malformed stored date, which has no next occurrence.
    const malformed: Occasion = { ...BIRTHDAY, date: '2000-02-30' };
    const { container } = render(<OccasionLabel occasion={malformed} />);
    expect(container).toHaveTextContent('Birthday');
    expect(container.innerHTML).not.toContain(PLACEHOLDER_YEAR);
  });

  it('says today and tomorrow', () => {
    vi.setSystemTime(localNoon(2026, 10, 13));
    const { unmount } = render(<OccasionLabel occasion={BIRTHDAY} />);
    expect(screen.getByText('Birthday · tomorrow')).toBeInTheDocument();
    unmount();

    vi.setSystemTime(localNoon(2026, 10, 14));
    render(<OccasionLabel occasion={BIRTHDAY} />);
    expect(screen.getByText('Birthday · today')).toBeInTheDocument();
  });

  it('shows a one-off that has passed as its kind and date, with no countdown', () => {
    const wedding: Occasion = { kind: 'wedding', date: '2026-06-12', recurrence: null };
    render(<OccasionLabel occasion={wedding} />);
    const label = screen.getByText(`Wedding · ${formatCalendarDate('2026-06-12')}`);
    expect(label).toHaveAttribute('dateTime', '2026-06-12');
    expect(label.textContent).not.toMatch(/today|tomorrow|days/);
  });

  it("takes the look it is given in place of the pill's, keeping its layout", () => {
    render(<OccasionLabel occasion={BIRTHDAY} className="my-badge" />);
    const badge = screen.getByText('Birthday · in 12 days').parentElement!;
    expect(badge).toHaveClass('my-badge', 'inline-flex', 'items-center', 'whitespace-nowrap');
    expect(badge).not.toHaveClass('bg-surface');
    expect(badge).not.toHaveClass('rounded-full');
  });

  it('moves on to the next day at local midnight', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 9, 13, 23, 59, 30));
    render(<OccasionLabel occasion={BIRTHDAY} />);
    expect(screen.getByText('Birthday · tomorrow')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.getByText('Birthday · today')).toBeInTheDocument();
  });

  it('reads the date again when the tab comes back into view', () => {
    render(<OccasionLabel occasion={BIRTHDAY} />);
    expect(screen.getByText('Birthday · in 12 days')).toBeInTheDocument();

    // Days later (a laptop that slept), the tab is shown again.
    vi.setSystemTime(localNoon(2026, 10, 12));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByText('Birthday · in 2 days')).toBeInTheDocument();
  });

  // The server's date can differ from the browser's. If the countdown were
  // worked out while rendering, the server's HTML and the hydrating render
  // would disagree, which React reports as a hydration error.
  it('renders only the kind on the server, and hydrates without a mismatch on another day', async () => {
    // The server renders on Oct 1 (say, still yesterday in UTC)…
    vi.setSystemTime(localNoon(2026, 10, 1));
    const html = renderToString(<OccasionLabel occasion={BIRTHDAY} />);
    expect(html).toContain('Birthday');
    expect(html).not.toMatch(/today|tomorrow|days/);
    expect(html).not.toContain(PLACEHOLDER_YEAR);

    // …and the browser hydrates it on Oct 2.
    vi.setSystemTime(localNoon(2026, 10, 2));
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const onRecoverableError = vi.fn();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, <OccasionLabel occasion={BIRTHDAY} />, {
        onRecoverableError,
      });
    });

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.textContent).toBe('Birthday · in 12 days');
    expect(container.innerHTML).not.toContain(PLACEHOLDER_YEAR);

    act(() => root?.unmount());
    container.remove();
    consoleError.mockRestore();
  });
});
