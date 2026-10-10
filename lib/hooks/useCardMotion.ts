'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cardMotionFor,
  MOTION_MS,
  prefersReducedMotion,
  STAGGER_TOTAL_MS,
  type CardMotion,
} from '@/lib/utils/motion';

/**
 * The moment one card is playing (WIS-407), started by `play` once the
 * viewer's own action has succeeded, and over after its `MOTION_MS`. `play`
 * answers whether it plays: never reservation motion for an owner or in
 * discreet mode, nothing under reduced motion (see `cardMotionFor`). Discreet
 * mode turned on while one plays stops it at once.
 */
export function useCardMotion({ isOwner, discreet }: { isOwner: boolean; discreet: boolean }) {
  const [motion, setMotion] = useState<CardMotion | null>(null);
  // Read when an action settles, which may be after a re-render changed them.
  const viewer = useRef({ isOwner, discreet });
  useEffect(() => {
    viewer.current = { isOwner, discreet };
  }, [isOwner, discreet]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const play = useCallback((wanted: CardMotion): boolean => {
    const shown = cardMotionFor(wanted, {
      ...viewer.current,
      reducedMotion: prefersReducedMotion(),
    });
    if (!shown) return false;
    clearTimeout(timer.current);
    setMotion(shown);
    timer.current = setTimeout(() => setMotion(null), MOTION_MS[shown]);
    return true;
  }, []);

  // Checked again as it renders, so a switch of mode (or role) mid-moment ends it.
  const shown = motion && cardMotionFor(motion, { isOwner, discreet, reducedMotion: false });
  return { motion: shown, play };
}

/**
 * Whether a list's grid staggers its cards in (WIS-407): once, as it first
 * appears after its items load, for `STAGGER_TOTAL_MS`. If it isn't showing by
 * then (an empty list, a filter that hides every card), it never staggers: a
 * card that a poll or a filter brings in later just appears.
 */
export function useStaggeredEntrance(ready: boolean, shown: boolean): boolean {
  const [phase, setPhase] = useState<'waiting' | 'entering' | 'done'>('waiting');
  useEffect(() => {
    if (phase === 'waiting' && ready) setPhase(shown ? 'entering' : 'done');
  }, [phase, ready, shown]);
  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = setTimeout(() => setPhase('done'), STAGGER_TOTAL_MS);
    return () => clearTimeout(timer);
  }, [phase]);
  return shown && phase !== 'done';
}
