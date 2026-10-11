// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import ItemCardView from '@/components/ItemCardView';
import { statusMeta } from '@/lib/utils/itemStatus';

function card(tags?: string[] | null, notes?: string) {
  render(
    <ItemCardView
      item={{ _id: 'i1', name: 'Novel', tags, notes }}
      status={statusMeta('available', 'member')}
      title={<button>Novel</button>}
    />
  );
}

describe('item card tags (WIS-452)', () => {
  afterEach(cleanup);

  it('shows no tag row for an untagged item', () => {
    card([]);
    expect(screen.queryByRole('list', { name: 'Tags' })).toBeNull();
  });

  it('shows up to two tags with no overflow chip', () => {
    card(['Books', 'Kitchen']);
    const list = screen.getByRole('list', { name: 'Tags' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(list.textContent).not.toContain('+');
  });

  it('shows the first two, then how many more', () => {
    card(['A', 'B', 'C', 'D', 'E']);
    const list = screen.getByRole('list', { name: 'Tags' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).queryByText('C')).toBeNull();
    expect(list.textContent).toContain('+3');
    expect(within(list).getByText('and 3 more tags')).toBeTruthy();
  });

  it('says "1 more tag" for a single overflow', () => {
    card(['A', 'B', 'C']);
    expect(screen.getByText('and 1 more tag')).toBeTruthy();
  });

  it('puts the tags straight under the price, above the notes, so a row of cards lines them up', () => {
    card(['Books'], 'Paperback, please');
    const list = screen.getByRole('list', { name: 'Tags' });
    const notes = screen.getByText('Paperback, please');
    expect(list.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
