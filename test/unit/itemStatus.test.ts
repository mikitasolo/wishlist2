import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import {
  displayStatus,
  STATUS_META,
  statusMeta,
  type DisplayStatus,
  type ItemStatus,
  type ViewerRole,
} from '@/lib/utils/itemStatus';
import { TONE_CLASSES, type StatusTone } from '@/lib/utils/statusTones';
import { listChips, LIST_CHIP_LABELS } from '@/lib/utils/listChips';
import { sourceFiles } from '../sourceFiles';

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
      bookedByMe: 'Reserved by you',
      bookedByOthers: 'Reserved',
      completed: 'Received',
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

  // regression: "Received" and "Reserved by you" were both emerald, so a member
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

// regression: every status surface used to pick its own raw palette class,
// so one status had several colours and several badges failed contrast.
describe('raw status palette classes', () => {
  // Not statuses: Avatar's gradients. (The "Most wanted" star has its own
  // tokens, `fill-star text-star-edge`; red is `danger`, WIS-290.)
  const EXEMPT_FILES = new Set([path.join('components', 'Avatar.tsx')]);
  const RAW =
    /\b(?:bg|text|border|ring|fill|stroke|from|to|via|outline|divide|shadow)-(?:emerald|amber|green|blue|yellow|teal|red|orange|rose)-\d/;

  it('are used nowhere in the app: status colours come from the tokens', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ['app', 'components', 'lib']) {
      for (const file of sourceFiles(path.join(process.cwd(), root))) {
        const rel = path.relative(process.cwd(), file);
        if (EXEMPT_FILES.has(rel)) continue;
        scanned++;
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (RAW.test(line)) offenders.push(`${rel}:${i + 1}`);
          });
      }
    }
    // It did look: the app's sources are all there.
    expect(scanned).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });

  it('catches one', () => {
    expect(RAW.test('className="bg-emerald-500 text-white"')).toBe(true);
    expect(RAW.test('className="dark:text-amber-400"')).toBe(true);
    expect(RAW.test('className="hover:bg-red-50 text-red-600"')).toBe(true);
    expect(RAW.test('className="fill-amber-400 text-amber-500"')).toBe(true);
    expect(RAW.test('className="bg-success-fill text-white"')).toBe(false);
    expect(RAW.test('className="fill-star text-star-edge text-danger"')).toBe(false);
  });
});

describe('owner status chips', () => {
  // regression: an owner's chips must never count or name booking.
  it('regression: gives an owner no booking chip', () => {
    for (const chip of listChips('owner')) {
      expect(LIST_CHIP_LABELS[chip]).not.toMatch(/book|reserv/i);
    }
  });
});
