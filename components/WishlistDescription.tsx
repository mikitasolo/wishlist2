'use client';

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';

/**
 * A list's description, as plain body text under its title: clamped to three
 * lines, with Show more / Show less when it runs longer.
 *
 * Whether it runs longer depends on the width it's laid out at, so it's
 * measured in the browser, after mount: the server render and the render that
 * hydrates it have no toggle, and a description that turns out to overflow
 * gets one then. A `ResizeObserver` measures it again when its width changes
 * (a phone turned sideways), and a new text (the 5s poll) is measured too.
 * Only the clamped text can be measured, so while it's expanded the toggle
 * stays as it was.
 *
 * Clamped, its blank lines close up (its line breaks stay): a paragraph break
 * as the third line would otherwise show as a lone "…".
 */
export default function WishlistDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  const id = useId();

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el || expanded) return;
    // A pixel of slack: a clamped box's heights can differ by a rounding error.
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [expanded]);

  useLayoutEffect(() => {
    measure();
  }, [measure, text]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  const shown = expanded ? text : text.replace(/\n\s*\n/g, '\n');

  return (
    <div className="mb-6 max-w-3xl">
      <p
        ref={ref}
        id={id}
        className={`whitespace-pre-line break-words text-body text-muted-foreground ${
          expanded ? '' : 'line-clamp-3'
        }`}
      >
        {shown}
      </p>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 rounded text-sm font-semibold text-foreground underline-offset-2 hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}
