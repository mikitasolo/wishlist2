// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import UsernameField from '@/components/UsernameField';
import {
  USERNAME_CHECK_DEBOUNCE_MS,
  useUsernameAvailability,
} from '@/lib/hooks/useUsernameAvailability';

/** The field wired to the hook the way the settings and welcome pages wire it. */
function Harness({ current, warn = false }: { current: string | null; warn?: boolean }) {
  const [value, setValue] = useState(current ?? '');
  const availability = useUsernameAvailability(value, current);
  return (
    <>
      <UsernameField
        value={value}
        onChange={setValue}
        availability={availability}
        savedUsername={warn ? current : null}
      />
      <output data-testid="availability">{availability}</output>
    </>
  );
}

type Check = { available: boolean; reason: string };
let checks: Map<string, (answer: Check) => void>;
const fetchMock = vi.fn((url: string) => {
  const name = new URL(url, 'http://localhost').searchParams.get('username')!;
  return new Promise((resolve) => {
    checks.set(name, (answer) =>
      resolve({ ok: true, json: async () => ({ success: true, ...answer }) })
    );
  });
});

const availability = () => screen.getByTestId('availability').textContent;
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('Username'), { target: { value } });
/** Let the debounce run out, so the check goes out. */
const pause = () => act(async () => vi.advanceTimersByTime(USERNAME_CHECK_DEBOUNCE_MS));
const answer = (name: string, result: Check) => act(async () => checks.get(name)!(result));

beforeEach(() => {
  cleanup();
  vi.useFakeTimers();
  checks = new Map();
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the link warning', () => {
  const warning = () => screen.queryByText(/Links you've already shared will stop working/);

  it('appears only once the field differs from the saved username', () => {
    render(<Harness current="alice" warn />);
    expect(warning()).toBeNull();

    type('alice_two');
    expect(warning()).toHaveTextContent('Your profile link becomes …/users/alice_two.');

    type('alice');
    expect(warning()).toBeNull();
  });

  it('is not shown for an empty field, or where no saved name is given', () => {
    render(<Harness current="alice" warn />);
    type('');
    expect(warning()).toBeNull();
    cleanup();

    render(<Harness current="alice" />);
    type('alice_two');
    expect(warning()).toBeNull();
  });
});

describe('UsernameField + useUsernameAvailability', () => {
  it('lowercases what is typed and checks nothing while it is the saved name', async () => {
    render(<Harness current="user_abc12345" />);
    type('USER_ABC12345');

    expect(screen.getByLabelText('Username')).toHaveValue('user_abc12345');
    await pause();
    expect(availability()).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks a malformed name invalid at once, without asking the server', async () => {
    render(<Harness current="user_abc12345" />);
    type('1abc');

    expect(screen.getByText('Invalid')).toBeInTheDocument();
    await pause();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks a well-formed name once typing pauses, and shows the answer', async () => {
    render(<Harness current="user_abc12345" />);
    type('jane');
    type('jane_d');

    expect(screen.getByText('Checking…')).toBeInTheDocument();
    await pause();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/users/check-username?username=jane_d');

    await answer('jane_d', { available: true, reason: 'ok' });
    expect(screen.getByText('Available')).toBeInTheDocument();
  });

  it('shows a taken or reserved name as Taken', async () => {
    render(<Harness current="user_abc12345" />);
    type('admin');
    await pause();
    await answer('admin', { available: false, reason: 'reserved' });
    expect(screen.getByText('Taken')).toBeInTheDocument();

    type('janedoe');
    await pause();
    await answer('janedoe', { available: false, reason: 'taken' });
    expect(screen.getByText('Taken')).toBeInTheDocument();
  });

  it('waits for the saved name before checking anything', async () => {
    render(<Harness current={null} />);
    type('jane');
    await pause();

    expect(availability()).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // regression: the settings page's check only cancelled a check that hadn't
  // gone out yet, so an answer landing after the name was edited again (it was
  // about the old name) still set the status, and could show the new name as
  // Available and enable Save.
  it('regression: drops an answer for a name that has since been edited', async () => {
    render(<Harness current="user_abc12345" />);
    type('jane');
    await pause(); // the check for "jane" is now in flight
    type('jane_taken');

    await answer('jane', { available: true, reason: 'ok' });
    expect(availability()).toBe('checking');
    expect(screen.queryByText('Available')).toBeNull();

    await pause();
    await answer('jane_taken', { available: false, reason: 'taken' });
    expect(screen.getByText('Taken')).toBeInTheDocument();
  });

  // regression: the settings page read any answer without `available: true` as
  // taken, so a refused check (the usernameCheck rate limit's 429, a 401 or a
  // 500, none of which carry a verdict) showed a free name as Taken.
  it('regression: a refused check falls back to idle instead of reading as taken', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ success: false, error: 'Too many requests. Please slow down.' }),
    });
    render(<Harness current="user_abc12345" />);
    type('jane');
    await pause();
    await act(async () => {});

    expect(availability()).toBe('idle');
    expect(screen.queryByText('Taken')).toBeNull();
  });

  it('falls back to idle when the check fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    render(<Harness current="user_abc12345" />);
    type('jane');
    await pause();

    expect(availability()).toBe('idle');
    expect(screen.queryByText(/Checking|Available|Taken|Invalid/)).toBeNull();
  });
});
