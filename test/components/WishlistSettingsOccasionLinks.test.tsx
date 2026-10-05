// @vitest-environment jsdom
// WIS-342: Settings says when share links follow the occasion.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/components/ToastProvider', () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import WishlistSettingsTab, { OCCASION_LINKS_NOTE } from '@/components/WishlistSettingsTab';
import { settingsFormFor, wishlistSettings } from '@/lib/utils/wishlistSettings';

afterEach(() => cleanup());

const saved = wishlistSettings({
  name: 'Wedding',
  slug: 'wedding',
  occasion: { kind: 'wedding', date: '2030-06-20', recurrence: null },
});

function renderTab(over: { occasionLinkCount?: number; archived?: boolean } = {}) {
  render(
    <WishlistSettingsTab
      form={settingsFormFor(saved)}
      saved={saved}
      dirty={false}
      saving={false}
      onEdit={vi.fn()}
      onSubmit={vi.fn()}
      onDiscard={vi.fn()}
      archived={over.archived ?? false}
      archiving={false}
      onArchive={vi.fn()}
      onUnarchive={vi.fn()}
      deleting={false}
      onDelete={vi.fn()}
      occasionLinkCount={over.occasionLinkCount}
    />
  );
}

describe('Settings: share links that follow the occasion', () => {
  it('says they move with it while there are some', () => {
    renderTab({ occasionLinkCount: 2 });
    expect(screen.getByText(OCCASION_LINKS_NOTE)).toBeInTheDocument();
  });

  it('says nothing without any, or on an archived list', () => {
    renderTab({ occasionLinkCount: 0 });
    expect(screen.queryByText(OCCASION_LINKS_NOTE)).toBeNull();
    cleanup();
    renderTab({ occasionLinkCount: 1, archived: true });
    expect(screen.queryByText(OCCASION_LINKS_NOTE)).toBeNull();
  });
});
