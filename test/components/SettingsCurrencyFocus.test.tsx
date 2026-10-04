// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const { push, showToast, update } = vi.hoisted(() => ({
  push: vi.fn(),
  showToast: vi.fn(),
  update: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: 'me', email: 'me@example.com', username: 'me' } },
    status: 'authenticated',
    update,
  }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// The header and the photo picker have their own fetches and tests.
vi.mock('@/components/AppHeader', () => ({ default: () => null }));
vi.mock('@/components/AuthButton', () => ({ default: () => null }));
vi.mock('@/components/ImageUpload', () => ({ default: () => null }));
vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast }) }));
vi.mock('@/components/ThemeProvider', () => ({
  useTheme: () => ({ theme: 'system', resolvedTheme: 'light', setTheme: vi.fn() }),
}));

import SettingsPage from '@/app/settings/page';
import { SETTINGS_CURRENCY_PATH } from '@/lib/utils/currencies';

const fetchMock = vi.fn(async (url: string) => {
  if (url === '/api/users/me') {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          email: 'me@example.com',
          username: 'me',
          image: null,
          bio: '',
          defaultCurrency: 'USD',
          privacy: { searchable: true, whoCanInvite: 'everyone', profileVisibility: 'everyone' },
        },
      }),
    };
  }
  throw new Error(`unexpected fetch ${url}`);
});

const currencyPicker = () => screen.findByRole('combobox', { name: 'Default currency' });

beforeEach(() => {
  cleanup();
  fetchMock.mockClear();
  global.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => window.history.replaceState(null, '', '/'));

// The dashboard's currency prompt sends "Choose another currency" to the picker.
describe('Settings, opened at the currency field', () => {
  it('focuses the currency picker once the form is in', async () => {
    window.history.replaceState(null, '', SETTINGS_CURRENCY_PATH);
    render(<SettingsPage />);

    const picker = await currencyPicker();
    await waitFor(() => expect(picker).toHaveFocus());
  });

  it('leaves the focus alone when opened anywhere else', async () => {
    window.history.replaceState(null, '', '/settings');
    render(<SettingsPage />);

    expect(await currencyPicker()).not.toHaveFocus();
  });
});
