'use client';

import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import Button from '@/components/Button';

/**
 * A list's description, as plain body text under its title: clamped to three
 * lines, with Show more / Show less when it runs longer.
 *
 * Its paragraphs (split on blank lines) are blocks a little apart, rather than
 * blank lines: the clamp counts the lines of all of them, and a blank line as
 * the third would show as a lone "…". A single line break stays one.
 *
 * Whether it runs longer depends on the width it's laid out at, so it's
 * measured in the browser, after mount: the server render and the render that
 * hydrates it have no toggle, and a description that turns out to overflow
 * gets one then. A `ResizeObserver` measures it again when its width changes
 * (a phone turned sideways), and a new text (the 5s poll) is measured too.
 * Only the clamped text can be measured, so while it's expanded the toggle
 * stays as it was.
 */
export default function WishlistDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
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

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());

  return (
    <div className="mb-6 max-w-3xl">
      <div
        ref={ref}
        id={id}
        className={`space-y-2 whitespace-pre-line break-words text-body text-muted-foreground ${
          expanded ? '' : 'line-clamp-3'
        }`}
      >
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
      {overflows && (
        <Button
          variant="ghost"
          size="sm"
          shape="pill"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
          // Its label lines up with the text above, its padding left out.
          className="-ml-3.5 mt-1"
        >
          {expanded ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
}
