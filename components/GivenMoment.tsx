import type { CSSProperties } from 'react';

/** The burst's dots, evenly round the check (degrees). */
const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The Mark as given moment (WIS-407): a check mark drawn in a circle with a
 * small burst of dots round it, over the card, about 600ms (`MOTION_MS.given`).
 * Decoration only: hidden from assistive tech (the toast says what happened),
 * never in the way of the pointer, and not drawn at all under reduced motion
 * (`globals.css`). The card it sits on needs `relative`; the caller renders it
 * only while the moment plays.
 */
export default function GivenMoment() {
  return (
    <span aria-hidden className="given-moment" data-testid="given-moment">
      <span className="given-moment-burst">
        {BURST_ANGLES.map((angle) => (
          <span key={angle} style={{ '--burst-angle': `${angle}deg` } as CSSProperties} />
        ))}
      </span>
      <svg viewBox="0 0 48 48" className="given-moment-check">
        <circle cx="24" cy="24" r="21" pathLength={1} />
        <path d="M15 24.5l6.5 6.5L33.5 18" pathLength={1} />
      </svg>
    </span>
  );
}
