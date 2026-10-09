'use client';

import Icon from '@/components/Icon';
import { useToast } from '@/components/ToastProvider';
import { useDiscreetMode } from '@/lib/hooks/useDiscreetMode';

/**
 * No spoiler mode's switch in the header (discreet mode, WIS-46), one tap from
 * every page: a pill with an eye, the name and a small track. Off it's quiet;
 * on, the eye is struck through, the knob slides over and the pill takes the
 * accent tint. Below `md` the name gives way to keep the header on one line
 * beside the links (at 640px it didn't fit, WIS-355), and below `lg` the open
 * search needs its room too, so the header passes `compact` while it's open. A
 * tooltip never shows on touch, so each switch says what it did in a toast:
 * often nothing on the page changes to show it (WIS-353).
 */
export default function NoSpoilerSwitch({ compact = false }: { compact?: boolean }) {
  const { discreet, setDiscreet } = useDiscreetMode();
  const { showToast } = useToast();

  const toggle = () => {
    const on = !discreet;
    setDiscreet(on);
    showToast(
      on
        ? 'No spoiler mode is on. Your reservations are hidden on this device.'
        : 'No spoiler mode is off. Your reservations show again.'
    );
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={discreet}
      aria-label="No spoiler mode"
      data-tour="no-spoiler"
      title={discreet ? 'No spoiler mode is on. Turn it off' : 'Turn on no spoiler mode'}
      onClick={toggle}
      className={`group inline-flex h-10 flex-shrink-0 items-center gap-2 rounded-full border pr-1.5 pl-3.5 text-sm font-medium whitespace-nowrap shadow-xs transition-[background-color,border-color,color,box-shadow] duration-200 active:scale-[0.97] motion-reduce:transition-none ${
        discreet
          ? 'border-primary-500/50 bg-primary-500/12 text-accent shadow-[0_6px_18px_-10px_rgba(94,92,230,0.9)] hover:bg-primary-500/18'
          : 'border-border-strong bg-surface text-muted-foreground hover:bg-surface-hover hover:text-foreground'
      }`}
    >
      <Icon
        name={discreet ? 'eye-off' : 'eye'}
        size={16}
        className="transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none"
      />
      <span className={`max-md:hidden ${compact ? 'max-lg:hidden' : ''}`}>No spoiler mode</span>
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 motion-reduce:transition-none ${
          discreet ? 'bg-primary-600' : 'bg-border-strong'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 motion-reduce:transition-none ${
            discreet ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </span>
    </button>
  );
}
