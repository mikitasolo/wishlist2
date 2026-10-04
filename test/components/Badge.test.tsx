// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Badge, { badgeClassName } from '@/components/Badge';
import { iconButtonClassName } from '@/components/buttonStyles';
import { STATUS_META, statusMeta } from '@/lib/utils/itemStatus';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

beforeEach(() => cleanup());

/** Every class in `classes` is on `el`. */
function expectClasses(el: HTMLElement, classes: string) {
  for (const c of classes.split(/\s+/).filter(Boolean)) expect(el).toHaveClass(c);
}

describe('Badge — item statuses', () => {
  it.each(Object.values(STATUS_META).filter((m) => m.badge))(
    'shows $label with the label, tone and fill statusMeta gives it',
    (meta) => {
      render(<Badge status={meta} />);
      const badge = screen.getByText(meta.label);
      expect(badge).toHaveAttribute('data-tone', meta.tone);
      expectClasses(badge, meta.classes.badge);
      // A status never rests on its colour alone.
      expect(badge.querySelector('svg')).not.toBeNull();
    }
  );

  it('never shows an owner a reserved status: statusMeta folds it into available', () => {
    const meta = statusMeta('booked', 'owner', { bookedByViewer: true });
    expect(meta.status).toBe('available');
    render(<Badge status={meta} />);
    expect(screen.queryByText(/Reserved/)).toBeNull();
  });

  it('shows a member their own reservation in the success tone, someone else’s in warning', () => {
    render(
      <>
        <Badge status={statusMeta('booked', 'member', { bookedByViewer: true })} />
        <Badge status={statusMeta('booked', 'member')} />
      </>
    );
    expect(screen.getByText('Reserved by you')).toHaveAttribute('data-tone', 'success');
    expect(screen.getByText('Reserved')).toHaveAttribute('data-tone', 'warning');
  });
});

describe('Badge — tones and sizes', () => {
  it.each([
    ['neutral', TONE_CLASSES.neutral.badge],
    ['info', TONE_CLASSES.info.tint],
    ['success', TONE_CLASSES.success.tint],
    ['warning', TONE_CLASSES.warning.tint],
    ['danger', TONE_CLASSES.danger.tint],
    ['glass', 'border-white/20 bg-black/60 text-white backdrop-blur-md'],
  ] as const)('the %s tone', (tone, classes) => {
    render(<Badge tone={tone}>Label</Badge>);
    expectClasses(screen.getByText('Label'), classes);
  });

  it('is neutral and md by default, with its icon', () => {
    render(<Badge icon="users">Friends</Badge>);
    const badge = screen.getByText('Friends');
    expectClasses(badge, `${TONE_CLASSES.neutral.badge} px-2.5 py-1 text-badge font-semibold`);
    expect(badge.querySelector('svg')).toHaveAttribute('width', '12');
  });

  it('darkens the glass over a greyed-out cover', () => {
    render(
      <Badge tone="glass" dim>
        Archived
      </Badge>
    );
    expect(screen.getByText('Archived')).toHaveClass('bg-black/70');
    expect(screen.getByText('Archived')).not.toHaveClass('bg-black/60');
  });

  it('is smaller at sm', () => {
    render(<Badge size="sm">3</Badge>);
    expectClasses(screen.getByText('3'), 'px-2 py-0.5');
  });

  it('gives a label that isn’t a Badge the same look', () => {
    expect(badgeClassName({ tone: 'glass' })).toContain('bg-black/60');
    expect(badgeClassName()).toContain(TONE_CLASSES.neutral.badge);
  });
});

// regression: WIS-308 — the glass tone was white text on a 20% white frost, which
// fell to about 1:1 over a bright cover photo and couldn't be read.
describe('Badge — glass over a cover', () => {
  it('is white text on a dark frost, never a light one', () => {
    render(<Badge tone="glass">Public</Badge>);
    const el = screen.getByText('Public');
    expect(el).toHaveClass('text-white', 'bg-black/60', 'backdrop-blur-md');
    expect(el.className).not.toMatch(/bg-white/);
  });

  it('the label for an occasion on a cover shares it', () => {
    const c = badgeClassName({ tone: 'glass' });
    expect(c).toContain('bg-black/60');
    expect(c).not.toMatch(/bg-white/);
  });

  it('keeps the glass icon button an opaque surface, readable on any photo', () => {
    const c = iconButtonClassName({ variant: 'glass' });
    expect(c).toContain('bg-surface/90');
    expect(c).not.toMatch(/bg-white|bg-black/);
  });

  it('keeps an archived cover’s frost at least as dark', () => {
    const c = badgeClassName({ tone: 'glass', dim: true });
    expect(c).toContain('bg-black/70');
    expect(c).not.toMatch(/bg-white/);
  });
});
