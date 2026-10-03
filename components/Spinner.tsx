/** sm 16px (inside a control), md 24px (over an upload), lg 32px (a card's whole content). */
export type SpinnerSize = 'sm' | 'md' | 'lg';

const SIZES: Record<SpinnerSize, string> = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-8 w-8' };

/**
 * The one spinner: a ring in the current text colour (`text-*` sets it, the
 * accent by default) that the `.spinner` rule in globals.css turns. For a
 * wait inside something already on screen (an upload, a sign-in check). A
 * page that's loading shows a skeleton of its layout instead (`Skeleton`).
 *
 * Silent by default, for one whose control already says what's happening;
 * pass `label` when nothing else does, and it becomes a `status` with that name.
 */
export default function Spinner({
  size = 'md',
  label,
  className = 'text-accent',
}: {
  size?: SpinnerSize;
  label?: string;
  /** Its colour, and any spacing. */
  className?: string;
}) {
  return (
    <span
      className={`spinner ${SIZES[size]} ${className}`}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
