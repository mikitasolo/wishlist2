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
import { usePathname, useRouter } from 'next/navigation';
import BaseModal from '@/components/BaseModal';
import Button from '@/components/Button';
import Icon from '@/components/Icon';
import { useToast } from '@/components/ToastProvider';
import { POPOVER_SURFACE } from '@/components/popoverStyles';
import TourIllustration from '@/components/TourIllustration';
import { track } from '@/lib/analytics';
import { useBodyScrollLock } from '@/lib/hooks/useBodyScrollLock';
import { useFocusTrap } from '@/lib/hooks/useFocusTrap';
import { FINE_POINTER_QUERY, SM_UP_QUERY } from '@/lib/hooks/useMediaQuery';
import { WELCOME_PARAM } from '@/lib/utils/memberWelcome';
import { NEW_LIST_PARAM } from '@/lib/utils/birthdayNudge';
import { placeTourPopover, type Placement } from '@/lib/utils/tourPlacement';
import {
  countedSteps,
  OPEN_NEW_LIST_EVENT,
  PRACTICE_OWNER_PATH,
  PRACTICE_PATH,
  TOUR_PARAM,
  TOUR_SETTINGS_ID,
  tourAllowedOn,
  tourStepPath,
  tourSteps,
  type TourStep,
  type TourTarget,
} from '@/lib/utils/tourSteps';
import {
  clearTourRunning,
  getCheckedFor,
  getStore,
  markTourRunning,
  setCheckedFor,
  setStore,
  subscribe,
  TOUR_BEAT_MS,
  tourRunningElsewhere,
  type TourBasis,
  type TourRun,
} from '@/components/walkthroughStore';
import type { WalkthroughAction, WalkthroughStatus } from '@/lib/utils/walkthrough';

/**
 * The guided walkthrough (WIS-371), mounted by `AppHeader` for someone signed
 * in, so it can carry on across pages. Once per tab it reads what's due from
 * `GET /api/users/me` (which also records the visit) and then shows:
 *
 * - **the tour** (`tourSteps`), one for everyone, one step at a time. Each
 *   step first takes them to its page (`tourStepPath`: Home, a list of their
 *   own or the practice list, Reserved, Settings), then dims the page around
 *   the real control it's about (a `data-tour` target) with a popover beside
 *   it (WIS-436). A "try it" step moves on when they use that control, once
 *   the dialog or menu it opened has closed; Next always works too. While any
 *   other dialog or menu is open the step steps aside. A target that never
 *   shows leaves a centred card with a made-up picture (`TourIllustration`).
 *   Skip (or Escape) at any step counts as done; skipping on the practice list
 *   goes Home. Someone who owns no list is offered Create a list at the end.
 * - **the offer** after three months away: a card asking "Want a quick look
 *   around?".
 *
 * Skipping, finishing or dismissing the offer always ends on a toast saying
 * Settings can start it again. A tab opened while another runs the tour (a
 * link opened in a new tab, the bookmarklet's) leaves it to that one
 * (`tourRunningElsewhere`). Never on a page `tourAllowedOn` refuses, and
 * not over a list just joined (`?welcome=1`, which has its own welcome note):
 * the next page shows it.
 */

/** Toast after the tour or its offer closes. */
export const TOUR_AGAIN_TOAST = 'You can take the tour again any time in Settings';

/** How long a step waits for its target to appear before it's a centred card. */
const TARGET_WAIT_MS = 600;
/** As long, on a page the step took them to, which may still be loading it. */
const PAGE_WAIT_MS = 3000;
const TARGET_POLL_MS = 100;
/** A used "try it" control moves the tour on once no dialog or menu has been open for this long. */
const SETTLE_MS = 450;

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

/**
 * A dialog, menu or open combobox (the search's results) on the page (the
 * tour's own popover is none of them): a step steps aside while one is, and a
 * used "try it" waits for it to close.
 */
function overlayOpen(): boolean {
  return !!document.querySelector(
    '[aria-modal="true"], [role="menu"], [role="combobox"][aria-expanded="true"]'
  );
}

/** Someone typing in a field inside the target (the header search): the popover would cover what it shows. */
function typingIn(target: HTMLElement): boolean {
  const active = document.activeElement;
  return !!active && target.contains(active) && active.matches('input, textarea');
}

/**
 * What draws the target: itself, or its first child (a `display: contents`
 * wrapper has no box of its own, and can't be scrolled to); null when not drawn.
 */
function tourTargetNode(el: HTMLElement): HTMLElement | null {
  if (!el.isConnected) return null;
  for (const node of [el, el.firstElementChild]) {
    if (!(node instanceof HTMLElement)) continue;
    const box = node.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return node;
  }
  return null;
}

function tourTargetBox(el: HTMLElement): DOMRect | null {
  return tourTargetNode(el)?.getBoundingClientRect() ?? null;
}

/** How far the spotlight's hole reaches past the target, in px. */
const SPOTLIGHT_PAD = 4;

/**
 * The spotlight's corners: the target's own, grown by the pad, so the hole
 * follows its shape (a pill stays a pill) with no undimmed corners showing.
 */
function spotlightRadius(el: HTMLElement): string {
  const node = tourTargetNode(el);
  if (!node || typeof window.getComputedStyle !== 'function') return `${SPOTLIGHT_PAD}px`;
  const style = window.getComputedStyle(node);
  const { width, height } = node.getBoundingClientRect();
  const half = Math.min(width, height) / 2;
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ]
    .map((value = '') => {
      const n = parseFloat(value) || 0;
      const px = value.trim().endsWith('%') ? (n / 100) * Math.min(width, height) : n;
      return `${Math.min(px, half) + SPOTLIGHT_PAD}px`;
    })
    .join(' ');
}

const matches = (query: string) =>
  typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;

/**
 * The bookmarklet step is for a mouse, from `sm` up (as `BookmarkletCard`):
 * read as the tour starts, since the media-query hook is still unknown then.
 */
const isDesktop = () => matches(FINE_POINTER_QUERY) && matches(SM_UP_QUERY);

/** The tour's shade over the rest of the page: the dialogs' backdrop colour (`bg-slate-900/40`), unblurred. */
const SHADE_COLOUR = 'rgb(15 23 42 / 0.4)';
/**
 * The spotlight: a ring in the focus colour on the hole, the page shaded
 * around it. The shade's corners round with the hole's, so it reaches 200vmax:
 * round a pill, 100vmax left a far corner of the screen unshaded.
 */
const SPOTLIGHT_SHADOW = `0 0 0 2px var(--ring), 0 0 0 200vmax ${SHADE_COLOUR}`;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function Walkthrough({ userId }: { userId: string }) {
  const { run, offer } = useSyncExternalStore(subscribe, getStore, getStore);
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const allowed = tourAllowedOn(pathname);

  const start = useCallback((status: TourBasis, source: 'auto' | 'offer' | 'settings') => {
    const desktop = isDesktop();
    const steps = tourSteps({ desktop, ownsList: status.ownsList });
    setStore({
      run: { steps, desktop, index: 0, listPath: status.listPath, arrived: false, used: false },
      offer: null,
    });
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
    } else if (getCheckedFor() === userId || url.searchParams.has(WELCOME_PARAM)) {
      return;
    }
    setCheckedFor(userId);
    (async () => {
      let status: WalkthroughStatus | undefined;
      try {
        const res = await fetch('/api/users/me');
        if (res.ok) status = (await res.json())?.data?.walkthrough;
      } catch {
        // Treated as no answer, below.
      }
      // A failed read is tried again on the next page.
      if (!status && getCheckedFor() === userId) setCheckedFor(null);
      // Another account may have signed in since, or a tour be running already.
      if (!status || getCheckedFor() !== userId || getStore().run) return;
      const basis = { ownsList: status.ownsList, listPath: status.listPath ?? null };
      if (fromSettings) start(basis, 'settings');
      // Running in another tab: this one (opened from it, say) leaves it there.
      else if (tourRunningElsewhere(userId)) return;
      else if (status.due === 'tour') start(basis, 'auto');
      else if (status.due === 'offer') setStore({ offer: basis });
    })();
  }, [allowed, pathname, userId, start]);

  // While it runs here, the account's other tabs know not to start it over.
  const running = !!run;
  useEffect(() => {
    if (!running) return;
    const beat = () => markTourRunning(userId);
    beat();
    const timer = window.setInterval(beat, TOUR_BEAT_MS);
    window.addEventListener('pageshow', beat);
    window.addEventListener('pagehide', clearTourRunning);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pageshow', beat);
      window.removeEventListener('pagehide', clearTourRunning);
      clearTourRunning();
    };
  }, [running, userId]);

  const remind = useCallback(() => {
    showToast(TOUR_AGAIN_TOAST, 'info', {
      action: { label: 'Open Settings', href: `/settings#${TOUR_SETTINGS_ID}` },
    });
  }, [showToast]);

  const finish = useCallback(
    (then?: () => void) => {
      if (!getStore().run) return;
      setStore({ run: null });
      then?.();
      remind();
      void sendAnswer('completed').then((ok) => ok && track('tour_finished'));
    },
    [remind]
  );

  const skip = useCallback(() => {
    const run = getStore().run;
    if (!run) return;
    const { steps, index } = run;
    const current = steps[index];
    if (!current || current.closing) return finish();
    setStore({ run: null });
    // The practice list is only for the tour.
    if (pathname === PRACTICE_PATH || pathname === PRACTICE_OWNER_PATH) router.push('/');
    remind();
    void sendAnswer('skipped').then(
      (ok) =>
        ok &&
        track('tour_skipped', {
          step: current.key as Exclude<typeof current.key, 'closing'>,
        })
    );
  }, [finish, remind, router, pathname]);

  const go = useCallback(
    (delta: number) => {
      const run = getStore().run;
      if (!run) return;
      const index = run.index + delta;
      if (index >= run.steps.length) return finish();
      if (index < 0) return;
      setStore({ run: { ...run, index, arrived: false, used: false } });
    },
    [finish]
  );

  const arrive = useCallback(() => {
    const run = getStore().run;
    if (run && !run.arrived) setStore({ run: { ...run, arrived: true } });
  }, []);

  const used = useCallback(() => {
    const run = getStore().run;
    if (run && !run.used) setStore({ run: { ...run, used: true } });
  }, []);

  // A used "try it" control: on to the next step once whatever it opened (a
  // dialog, a menu) has closed and things have been quiet a moment. A page it
  // goes to (Reserved) is where the next step starts.
  const waitingOn = run?.used ? run.index : null;
  useEffect(() => {
    if (waitingOn === null) return;
    let quiet = 0;
    const timer = window.setInterval(() => {
      quiet = overlayOpen() ? 0 : quiet + TARGET_POLL_MS;
      if (quiet >= SETTLE_MS && getStore().run?.index === waitingOn) {
        window.clearInterval(timer);
        go(1);
      }
    }, TARGET_POLL_MS);
    return () => window.clearInterval(timer);
  }, [waitingOn, go]);

  const createList = useCallback(() => {
    finish(() => {
      if (pathname === '/') window.dispatchEvent(new Event(OPEN_NEW_LIST_EVENT));
      else router.push(`/?${NEW_LIST_PARAM}=new`);
    });
  }, [finish, pathname, router]);

  const acceptOffer = useCallback(() => {
    const { offer } = getStore();
    if (!offer) return;
    start(offer, 'offer');
    void sendAnswer('offer_accepted').then((ok) => {
      if (!ok) return;
      track('tour_offer_accepted');
      track('tour_started', { source: 'offer' });
    });
  }, [start]);

  const dismissOffer = useCallback(() => {
    if (!getStore().offer) return;
    setStore({ offer: null });
    remind();
    void sendAnswer('offer_dismissed').then((ok) => ok && track('tour_offer_dismissed'));
  }, [remind]);

  if (!allowed) return null;

  if (offer) {
    return <TourOffer onAccept={acceptOffer} onDismiss={dismissOffer} />;
  }

  if (!run || run.used) return null;
  const step = run.steps[run.index];
  if (!step) return null;
  return (
    <TourStepView
      // A fresh view per step and page: its own target search, and focus moved to it.
      key={`${pathname}:${step.key}`}
      step={step}
      pathname={pathname}
      destination={tourStepPath(step, run.listPath)}
      onArrive={arrive}
      onGo={(path) => router.push(path)}
      onUsed={used}
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
  pathname: string;
  /** The step's page (`tourStepPath`), or null for wherever they are. */
  destination: string | null;
  onArrive: () => void;
  onGo: (path: string) => void;
  /** Its "try it" control was used. */
  onUsed: () => void;
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
  const { step, pathname, destination, onArrive, onGo } = props;
  const [mode, setMode] = useState<Mode>({ kind: 'pending' });

  // First to the step's page, unless it's been there already this step (they
  // may have wandered off: they aren't taken back). Then look for its target
  // for a moment (the page may still be loading it), and settle: beside it,
  // or a centred card. Whether it has arrived is read from the store, not
  // the props, so an effect run twice (StrictMode) goes there once.
  useEffect(() => {
    const target = step.target;
    const here = !destination || destination.split('?')[0] === pathname;
    if (!getStore().run?.arrived && !here) {
      onArrive();
      onGo(destination!);
      return;
    }
    if (here) onArrive();
    if (!target) {
      setMode({ kind: 'centred' });
      return;
    }
    const wait = step.page ? PAGE_WAIT_MS : TARGET_WAIT_MS;
    let tries = 0;
    const look = () => {
      const el = findTourTarget(target);
      if (el) {
        // The node that draws it: a `display: contents` wrapper doesn't scroll.
        (tourTargetNode(el) ?? el).scrollIntoView?.({
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
      else if (tries * TARGET_POLL_MS >= wait) {
        window.clearInterval(timer);
        setMode({ kind: 'centred' });
      }
    }, TARGET_POLL_MS);
    return () => window.clearInterval(timer);
    // Once per view: the view is keyed by step and page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

/**
 * The step's text. Beside the real control, what to try with it; on the
 * centred card (no control on screen), the made-up picture instead.
 */
function StepBody({ step, anchored }: { step: TourStep; anchored: boolean }) {
  return (
    <>
      {!anchored && step.illustration && <TourIllustration kind={step.illustration} />}
      <p className="text-sm text-foreground">{step.body}</p>
      {anchored && step.tryIt && (
        <p className="mt-2 flex items-start gap-1.5 text-sm font-medium text-accent">
          <Icon name="arrow-right" size={16} className="mt-0.5 flex-shrink-0" />
          {step.tryIt}
        </p>
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

/** The step's popover contents, the same beside a target and on the centred card. */
function StepPanel(props: StepViewProps & { titleId: string; bodyId: string; anchored: boolean }) {
  const { step, position, total, titleId, bodyId, anchored } = props;
  return (
    <>
      <StepCounter position={position} total={total} />
      <h2
        id={titleId}
        className={`${position === null ? '' : 'mt-1'} text-base font-semibold text-foreground`}
      >
        {step.title}
      </h2>
      <div id={bodyId} className="mt-1">
        <StepBody step={step} anchored={anchored} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <StepButtons {...props} />
      </div>
    </>
  );
}

/** The popover's box, beside a target or centred. */
const PANEL_CLASS = `${POPOVER_SURFACE} w-[min(20rem,calc(100vw-2rem))] p-4`;

/**
 * The closing card, or a step whose target never showed: the same popover as
 * every other step, centred over the same unblurred shade.
 */
function CentredStep(props: StepViewProps) {
  const { onSkip } = props;
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(true, panel);
  useBodyScrollLock(true);

  // Escape skips the tour (on the closing card, finishes it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSkip]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: SHADE_COLOUR }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={`${PANEL_CLASS} max-h-full overflow-y-auto`}
      >
        <StepPanel {...props} titleId={titleId} bodyId={bodyId} anchored={false} />
      </div>
    </div>,
    document.body
  );
}

function AnchoredStep(props: StepViewProps & { target: HTMLElement; onTargetLost: () => void }) {
  const { step, onSkip, onUsed, target, onTargetLost } = props;
  const titleId = useId();
  const bodyId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<DOMRect | null>(() => tourTargetBox(target));
  const [radius, setRadius] = useState(() => spotlightRadius(target));
  const [placement, setPlacement] = useState<Placement | null>(null);
  // A dialog or menu is open (one the page opened, or the target did): out of its way.
  const [aside, setAside] = useState(false);
  // A "try it" step leaves Tab free to reach the control it's about.
  useFocusTrap(!aside && !step.tryIt, panel);

  // A "try it" step: using the control is the answer.
  useEffect(() => {
    if (!step.tryIt) return;
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && target.contains(e.target)) onUsed();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [step.tryIt, target, onUsed]);

  // Follow the target as the page scrolls, resizes or re-renders under it.
  useEffect(() => {
    const measure = () => {
      setAside(overlayOpen() || typingIn(target));
      const next = tourTargetBox(target);
      if (!next) return onTargetLost();
      setRadius(spotlightRadius(target));
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
    // Into the search field and out of it: out of the way of its results at once.
    document.addEventListener('focusin', measure);
    document.addEventListener('focusout', measure);
    const timer = window.setInterval(measure, 250);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      document.removeEventListener('focusin', measure);
      document.removeEventListener('focusout', measure);
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

  if (!box || aside) return null;
  return createPortal(
    <>
      {/* The spotlight: the page dimmed around a ring on the real control,
          shaped like it. It takes no pointer events, so the control (and the
          page) stay usable. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed z-50 motion-safe:transition-all motion-safe:duration-200"
        style={{
          top: box.top - SPOTLIGHT_PAD,
          left: box.left - SPOTLIGHT_PAD,
          width: box.width + 2 * SPOTLIGHT_PAD,
          height: box.height + 2 * SPOTLIGHT_PAD,
          borderRadius: radius,
          boxShadow: SPOTLIGHT_SHADOW,
        }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        className={`${PANEL_CLASS} fixed z-50 motion-safe:transition-[top,left] motion-safe:duration-200`}
        style={{
          top: placement?.top ?? 0,
          left: placement?.left ?? 0,
          // Transparent, not hidden, until placed: hidden, it couldn't take focus.
          opacity: placement ? 1 : 0,
        }}
      >
        <StepPanel {...props} titleId={titleId} bodyId={bodyId} anchored />
      </div>
    </>,
    document.body
  );
}
