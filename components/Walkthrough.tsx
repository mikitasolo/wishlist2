'use client';

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import BaseModal from '@/components/BaseModal';
import Button from '@/components/Button';
import { useToast } from '@/components/ToastProvider';
import { POPOVER_SURFACE } from '@/components/popoverStyles';
import TourIllustration from '@/components/TourIllustration';
import { track } from '@/lib/analytics';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { FINE_POINTER_QUERY, SM_UP_QUERY } from '@/lib/hooks/useMediaQuery';
import { WELCOME_PARAM } from '@/lib/utils/memberWelcome';
import { NEW_LIST_PARAM } from '@/lib/utils/birthdayNudge';
import { placeTourPopover, type Placement } from '@/lib/utils/tourPlacement';
import {
  countedSteps,
  OPEN_NEW_LIST_EVENT,
  TOUR_PARAM,
  TOUR_SETTINGS_ID,
  tourAllowedOn,
  tourSteps,
  type TourStep,
  type TourTarget,
} from '@/lib/utils/tourSteps';
import type { WalkthroughAction, WalkthroughStatus } from '@/lib/utils/walkthrough';

/**
 * The guided walkthrough (WIS-371), mounted by `AppHeader` for someone signed
 * in, so it can carry on across pages. Once per tab it reads what's due from
 * `GET /api/users/me` (which also records the visit) and then shows:
 *
 * - **the tour** (`tourSteps`), one for everyone, one step at a time: a
 *   popover beside the real UI it's about (a `data-tour` target), or a
 *   centred card where the page doesn't have it on screen, each with its
 *   made-up picture (`TourIllustration`). Skip (or Escape) at any step counts
 *   as done. Someone who owns no list is offered Create a list at the end.
 * - **the offer** after three months away: a card asking "Want a quick look
 *   around?".
 *
 * Skipping, finishing or dismissing the offer always ends on a toast saying
 * Settings can start it again. Never on a page `tourAllowedOn` refuses, and
 * not over a list just joined (`?welcome=1`, which has its own welcome note):
 * the next page shows it.
 */

/** Toast after the tour or its offer closes. */
export const TOUR_AGAIN_TOAST = 'You can take the tour again any time in Settings';

/** How long a step waits for its target to appear (a page still loading) before it's a centred card. */
const TARGET_WAIT_MS = 600;
const TARGET_POLL_MS = 100;

interface TourRun {
  steps: TourStep[];
  index: number;
}

interface TourStore {
  run: TourRun | null;
  /** The offer, while it's showing: whether they own a list, for the tour it starts. */
  offer: { ownsList: boolean } | null;
}

// One tour per tab, across the page changes that remount the header.
let store: TourStore = { run: null, offer: null };
const listeners = new Set<() => void>();
// The account this tab has already read the tour's status for.
let checkedFor: string | null = null;

function setStore(next: Partial<TourStore>) {
  store = { ...store, ...next };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets the tab's tour state (tests). */
export function resetWalkthroughForTests() {
  store = { run: null, offer: null };
  checkedFor = null;
  listeners.forEach((listener) => listener());
}

/** Sends an answer; resolves whether it landed. */
async function sendAnswer(action: WalkthroughAction): Promise<boolean> {
  try {
    const res = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walkthrough: action }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The first `data-tour` element of that name the page has on screen, if any. */
export function findTourTarget(target: TourTarget): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`)) {
    const box = tourTargetBox(el);
    if (box) return el;
  }
  return null;
}

/** Its box, or its first child's (a `display: contents` wrapper has none); null when not drawn. */
function tourTargetBox(el: HTMLElement): DOMRect | null {
  if (!el.isConnected) return null;
  for (const node of [el, el.firstElementChild]) {
    if (!node) continue;
    const box = node.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return box;
  }
  return null;
}

const matches = (query: string) =>
  typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;

/**
 * The bookmarklet step is for a mouse, from `sm` up (as `BookmarkletCard`):
 * read as the tour starts, since the media-query hook is still unknown then.
 */
const isDesktop = () => matches(FINE_POINTER_QUERY) && matches(SM_UP_QUERY);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function Walkthrough({ userId }: { userId: string }) {
  const { run, offer } = useSyncExternalStore(
    subscribe,
    () => store,
    () => store
  );
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const allowed = tourAllowedOn(pathname);

  const start = useCallback((ownsList: boolean, source: 'auto' | 'offer' | 'settings') => {
    const steps = tourSteps({ desktop: isDesktop(), ownsList });
    setStore({ run: { steps, index: 0 }, offer: null });
    if (source !== 'offer') track('tour_started', { source });
  }, []);

  // What's due: read once per tab, or again when Settings sends here to start it.
  useEffect(() => {
    if (!allowed) return;
    const url = new URL(window.location.href);
    const fromSettings = url.searchParams.get(TOUR_PARAM) === 'start';
    if (fromSettings) {
      url.searchParams.delete(TOUR_PARAM);
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${url.search}${url.hash}`
      );
    } else if (checkedFor === userId || url.searchParams.has(WELCOME_PARAM)) {
      return;
    }
    checkedFor = userId;
    (async () => {
      let status: WalkthroughStatus | undefined;
      try {
        const res = await fetch('/api/users/me');
        if (res.ok) status = (await res.json())?.data?.walkthrough;
      } catch {
        // Treated as no answer, below.
      }
      // A failed read is tried again on the next page.
      if (!status && checkedFor === userId) checkedFor = null;
      // Another account may have signed in since, or a tour be running already.
      if (!status || checkedFor !== userId || store.run) return;
      if (fromSettings) start(status.ownsList, 'settings');
      else if (status.due === 'tour') start(status.ownsList, 'auto');
      else if (status.due === 'offer') setStore({ offer: { ownsList: status.ownsList } });
    })();
  }, [allowed, pathname, userId, start]);

  const remind = useCallback(() => {
    showToast(TOUR_AGAIN_TOAST, 'info', {
      action: { label: 'Open Settings', href: `/settings#${TOUR_SETTINGS_ID}` },
    });
  }, [showToast]);

  const finish = useCallback(
    (then?: () => void) => {
      if (!store.run) return;
      setStore({ run: null });
      then?.();
      remind();
      void sendAnswer('completed').then((ok) => ok && track('tour_finished'));
    },
    [remind]
  );

  const skip = useCallback(() => {
    if (!store.run) return;
    const { steps, index } = store.run;
    const current = steps[index];
    if (!current || current.closing) return finish();
    setStore({ run: null });
    remind();
    void sendAnswer('skipped').then(
      (ok) =>
        ok &&
        track('tour_skipped', {
          step: current.key as Exclude<typeof current.key, 'closing'>,
        })
    );
  }, [finish, remind]);

  const go = useCallback(
    (delta: number) => {
      if (!store.run) return;
      const index = store.run.index + delta;
      if (index >= store.run.steps.length) return finish();
      if (index < 0) return;
      setStore({ run: { ...store.run, index } });
    },
    [finish]
  );

  const createList = useCallback(() => {
    finish(() => {
      if (pathname === '/') window.dispatchEvent(new Event(OPEN_NEW_LIST_EVENT));
      else router.push(`/?${NEW_LIST_PARAM}=new`);
    });
  }, [finish, pathname, router]);

  const acceptOffer = useCallback(() => {
    if (!store.offer) return;
    start(store.offer.ownsList, 'offer');
    void sendAnswer('offer_accepted').then((ok) => {
      if (!ok) return;
      track('tour_offer_accepted');
      track('tour_started', { source: 'offer' });
    });
  }, [start]);

  const dismissOffer = useCallback(() => {
    if (!store.offer) return;
    setStore({ offer: null });
    remind();
    void sendAnswer('offer_dismissed').then((ok) => ok && track('tour_offer_dismissed'));
  }, [remind]);

  if (!allowed) return null;

  if (offer) {
    return <TourOffer onAccept={acceptOffer} onDismiss={dismissOffer} />;
  }

  if (!run) return null;
  const step = run.steps[run.index];
  if (!step) return null;
  return (
    <TourStepView
      // A fresh view per step: its own target search, and focus moved to it.
      key={`${pathname}:${step.key}`}
      step={step}
      position={step.closing ? null : run.index + 1}
      total={countedSteps(run.steps)}
      last={run.index === run.steps.length - 1}
      onBack={run.index > 0 ? () => go(-1) : undefined}
      onNext={() => go(1)}
      onSkip={skip}
      onCreateList={createList}
    />
  );
}

function TourOffer({ onAccept, onDismiss }: { onAccept: () => void; onDismiss: () => void }) {
  const titleId = useId();
  return (
    <BaseModal
      isOpen
      onClose={onDismiss}
      title="Want a quick look around?"
      titleId={titleId}
      size="sm"
      closeLabel="Close"
      closeOnBackdrop={false}
      footer={
        <>
          <Button variant="secondary" onClick={onDismiss}>
            Not now
          </Button>
          <Button onClick={onAccept} autoFocus>
            Take the tour
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Welcome back. A short tour shows what’s here and where to find it.
      </p>
    </BaseModal>
  );
}

interface StepViewProps {
  step: TourStep;
  /** 1-based, or null for the closing card. */
  position: number | null;
  total: number;
  last: boolean;
  onBack?: () => void;
  onNext: () => void;
  onSkip: () => void;
  onCreateList: () => void;
}

type Mode = { kind: 'pending' } | { kind: 'anchored'; el: HTMLElement } | { kind: 'centred' };

function TourStepView(props: StepViewProps) {
  const { step } = props;
  const [mode, setMode] = useState<Mode>(() =>
    step.target ? { kind: 'pending' } : { kind: 'centred' }
  );

  // Look for the step's target for a moment (the page may still be loading
  // it), then settle: beside it, or a centred card.
  useEffect(() => {
    const target = step.target;
    if (!target) return;
    let tries = 0;
    const look = () => {
      const el = findTourTarget(target);
      if (el) {
        el.scrollIntoView?.({
          block: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
        setMode({ kind: 'anchored', el });
        return true;
      }
      return false;
    };
    if (look()) return;
    const timer = window.setInterval(() => {
      tries += 1;
      if (look()) window.clearInterval(timer);
      else if (tries * TARGET_POLL_MS >= TARGET_WAIT_MS) {
        window.clearInterval(timer);
        setMode({ kind: 'centred' });
      }
    }, TARGET_POLL_MS);
    return () => window.clearInterval(timer);
  }, [step.target]);

  const toCentred = useCallback(() => setMode({ kind: 'centred' }), []);

  if (mode.kind === 'pending') return null;
  if (mode.kind === 'anchored') {
    return <AnchoredStep {...props} target={mode.el} onTargetLost={toCentred} />;
  }
  return <CentredStep {...props} />;
}

function StepCounter({ position, total }: { position: number | null; total: number }) {
  if (position === null) return null;
  return (
    <p className="text-xs font-medium text-muted-foreground">
      {position} of {total}
    </p>
  );
}

function StepBody({ step }: { step: TourStep }) {
  return (
    <>
      {step.illustration && <TourIllustration kind={step.illustration} />}
      <p className="text-sm text-foreground">{step.body}</p>
      {step.link && (
        <Link
          href={step.link.href}
          className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
        >
          {step.link.label}
        </Link>
      )}
    </>
  );
}

function StepButtons({ step, last, onBack, onNext, onSkip, onCreateList }: StepViewProps) {
  return (
    <>
      {!step.closing && (
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip tour
        </Button>
      )}
      {onBack && !step.closing && (
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back
        </Button>
      )}
      {step.createList && (
        <Button variant="secondary" size="sm" onClick={onCreateList}>
          Create a list
        </Button>
      )}
      <Button size="sm" onClick={onNext} autoFocus>
        {last ? 'Done' : 'Next'}
      </Button>
    </>
  );
}

function CentredStep(props: StepViewProps) {
  const { step, position, total, onSkip } = props;
  const titleId = useId();
  return (
    <BaseModal
      isOpen
      // Escape and the close button skip the tour (on the closing card, finish it).
      onClose={onSkip}
      title={step.title}
      titleId={titleId}
      size="sm"
      closeLabel={step.closing ? 'Close' : 'Close tour'}
      closeOnBackdrop={false}
      footer={<StepButtons {...props} />}
    >
      <StepCounter position={position} total={total} />
      <div className={position === null ? '' : 'mt-1'}>
        <StepBody step={step} />
      </div>
    </BaseModal>
  );
}

function AnchoredStep(props: StepViewProps & { target: HTMLElement; onTargetLost: () => void }) {
  const { step, position, total, onSkip, target, onTargetLost } = props;
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<DOMRect | null>(() => tourTargetBox(target));
  const [placement, setPlacement] = useState<Placement | null>(null);
  useFocusTrap(true, panel);

  // Follow the target as the page scrolls, resizes or re-renders under it.
  useEffect(() => {
    const measure = () => {
      const next = tourTargetBox(target);
      if (!next) return onTargetLost();
      setBox((prev) =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next
      );
    };
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    const timer = window.setInterval(measure, 250);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      window.clearInterval(timer);
    };
  }, [target, onTargetLost]);

  useLayoutEffect(() => {
    if (!box || !panel.current) return;
    const { offsetWidth: width, offsetHeight: height } = panel.current;
    setPlacement(
      placeTourPopover(
        box,
        { width, height },
        // The viewport without its scrollbar.
        { width: document.documentElement.clientWidth, height: window.innerHeight }
      )
    );
  }, [box]);

  // Escape skips, as on the centred card, but only from inside the popover:
  // the highlighted control stays usable, and Escape in a dialog or menu it
  // opened is that one's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && panel.current?.contains(document.activeElement)) {
        e.preventDefault();
        onSkip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSkip]);

  if (!box) return null;
  return createPortal(
    <>
      {/* The highlight: a ring around the real control, which the pointer can still use. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-50 rounded-2xl ring-2 ring-ring ring-offset-2 ring-offset-background motion-safe:transition-all motion-safe:duration-200"
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={`${POPOVER_SURFACE} fixed z-50 w-[min(20rem,calc(100vw-2rem))] p-4 motion-safe:transition-[top,left] motion-safe:duration-200`}
        style={{
          top: placement?.top ?? 0,
          left: placement?.left ?? 0,
          // Transparent, not hidden, until placed: hidden, it couldn't take focus.
          opacity: placement ? 1 : 0,
        }}
      >
        <StepCounter position={position} total={total} />
        <h2 id={titleId} className="mt-1 text-base font-semibold text-foreground">
          {step.title}
        </h2>
        <div id={bodyId} className="mt-1">
          <StepBody step={step} />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <StepButtons {...props} />
        </div>
      </div>
    </>,
    document.body
  );
}
