import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  displayStatus,
  FILTER_META,
  STATUS_META,
  statusMeta,
  TONE_CLASSES,
  type DisplayStatus,
  type ItemStatus,
  type StatusTone,
  type ViewerRole,
} from '@/lib/utils/itemStatus';
import { statusFilterOptions } from '@/lib/utils/itemFilters';

const STATUSES: ItemStatus[] = ['draft', 'proposed', 'available', 'booked', 'completed'];
const ROLES: ViewerRole[] = ['owner', 'member', 'visitor'];

// What every status looks like to every role, booked by the viewer or not.
const EXPECTED: Record<ViewerRole, Record<ItemStatus, [DisplayStatus, DisplayStatus]>> = {
  owner: {
    draft: ['draft', 'draft'],
    proposed: ['proposed', 'proposed'],
    available: ['available', 'available'],
    booked: ['available', 'available'],
    completed: ['completed', 'completed'],
  },
  member: {
    draft: ['draft', 'draft'],
    proposed: ['proposed', 'proposed'],
    available: ['available', 'available'],
    booked: ['bookedByOthers', 'bookedByMe'],
    completed: ['completed', 'completed'],
  },
  visitor: {
    draft: ['draft', 'draft'],
    proposed: ['proposed', 'proposed'],
    available: ['available', 'available'],
    booked: ['bookedByOthers', 'bookedByMe'],
    completed: ['completed', 'completed'],
  },
};

describe('statusMeta', () => {
  for (const role of ROLES) {
    for (const status of STATUSES) {
      it(`gives a ${role} the right meta for a ${status} item`, () => {
        const [notMine, mine] = EXPECTED[role][status];
        expect(statusMeta(status, role).status).toBe(notMine);
        expect(statusMeta(status, role, { bookedByViewer: true }).status).toBe(mine);
        expect(displayStatus(status, role, true)).toBe(mine);
      });
    }
  }

  // regression: owners must never see booking status. A booked item is
  // available to every owner, with no booked label or tone, even one the
  // read says they booked themselves.
  it('regression: gives an owner the available meta for a booked item', () => {
    for (const bookedByViewer of [false, true]) {
      const meta = statusMeta('booked', 'owner', { bookedByViewer });
      expect(meta).toBe(STATUS_META.available);
      expect(meta.label).toBe('Available');
      expect(meta.tone).toBe('neutral');
      expect(meta.badge).toBe(false);
      expect(meta.label).not.toMatch(/book|reserv/i);
      expect(meta.classes.card).toBe('border-border');
    }
  });

  it('keeps today’s labels', () => {
    expect(Object.fromEntries(Object.values(STATUS_META).map((m) => [m.status, m.label]))).toEqual({
      draft: 'Draft',
      proposed: 'Proposed',
      available: 'Available',
      bookedByMe: 'Booked by you',
      bookedByOthers: 'Booked',
      completed: 'Completed',
    });
  });

  it('gives each status its tone, and an icon on every badge', () => {
    const tones: Record<DisplayStatus, StatusTone> = {
      draft: 'draft',
      proposed: 'info',
      available: 'neutral',
      bookedByMe: 'success',
      bookedByOthers: 'warning',
      completed: 'done',
    };
    for (const meta of Object.values(STATUS_META)) {
      expect(meta.tone).toBe(tones[meta.status]);
      expect(meta.classes).toBe(TONE_CLASSES[meta.tone]);
      if (meta.badge) expect(meta.icon).not.toBeNull();
    }
  });

  // regression: "Completed" and "Booked by you" were both emerald, so a member
  // couldn't tell them apart on one grid. Completed is neutral now.
  it('regression: completed doesn’t share a colour with booked by you', () => {
    const done = STATUS_META.completed.classes;
    const mine = STATUS_META.bookedByMe.classes;
    expect(done.badge).not.toBe(mine.badge);
    expect(done.card).not.toBe(mine.card);
    expect(done.text).not.toBe(mine.text);
    expect(done.badge).toBe('bg-foreground text-background');
  });

  it('colours every tone with the status tokens, never raw palette classes', () => {
    for (const classes of Object.values(TONE_CLASSES)) {
      for (const value of Object.values(classes)) {
        expect(value).not.toMatch(/\b(emerald|amber|green|blue|yellow|red|teal)-\d/);
      }
    }
  });

  it('defines every token the tones use, in both themes where it changes', () => {
    const css = readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
    for (const tone of ['info', 'success', 'warning', 'danger']) {
      for (const suffix of ['', '-fill', '-fill-hover']) {
        expect(css).toContain(`--color-${tone}${suffix}: var(--${tone}${suffix});`);
      }
    }
    const dark = css.slice(css.indexOf(":root[data-theme='dark']"));
    for (const tone of ['success', 'warning', 'danger']) {
      expect(dark).toMatch(new RegExp(`--${tone}: oklch\\(`));
    }
  });
});

describe('FILTER_META', () => {
  it('labels every stat card and filter option, in the status map’s tone', () => {
    expect(FILTER_META.all).toEqual({ label: 'All', tone: 'neutral' });
    expect(FILTER_META.bookedByMe).toEqual({ label: 'Booked by You', tone: 'success' });
    expect(FILTER_META.bookedByOthers).toEqual({ label: 'Booked by Others', tone: 'warning' });
    expect(FILTER_META.proposedByMe).toEqual({ label: 'Proposed by You', tone: 'info' });
    expect(FILTER_META.completed).toEqual({ label: 'Completed', tone: 'done' });
  });

  // regression: an owner's cards must never count or name booking.
  it('regression: gives an owner no booking card', () => {
    for (const option of statusFilterOptions('owner')) {
      expect(FILTER_META[option].label).not.toMatch(/book|reserv/i);
      expect(['success', 'warning']).not.toContain(FILTER_META[option].tone);
    }
  });
});
