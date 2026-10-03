import type { AriaRole, ReactNode } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

/**
 * - `info`: something worth knowing before you go on (a proposal waits for the
 *   owner, how reviewing works).
 * - `warning`: think before you go on.
 * - `danger`: something failed (a sign-in link that didn't work).
 */
export type CalloutTone = 'info' | 'warning' | 'danger';

const ICONS: Record<CalloutTone, IconName> = { info: 'info', warning: 'alert', danger: 'alert' };

/**
 * `danger` is an `alert`, announced as it appears; `info` and `warning` are a
 * `note`, read in place, since they explain the form they're in rather than
 * report something that just happened.
 */
const ROLES: Record<CalloutTone, AriaRole> = { info: 'note', warning: 'note', danger: 'alert' };

/**
 * A notice in a form or page: an icon and a line or two, on the tone's tint
 * and border (`TONE_CLASSES[tone].notice`, the status tokens). Every inline
 * notice is one of these, never a hand-coloured box.
 */
export default function Callout({
  tone = 'info',
  icon,
  role,
  className = '',
  children,
}: {
  tone?: CalloutTone;
  /** Replaces the tone's icon. */
  icon?: IconName;
  /** Replaces the tone's role (see `ROLES`). */
  role?: AriaRole;
  /** Spacing around it: never colours, which are the tone's. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={role ?? ROLES[tone]}
      data-tone={tone}
      className={`flex items-start gap-2.5 rounded-xl p-3.5 text-sm ${TONE_CLASSES[tone].notice} ${className}`}
    >
      <Icon name={icon ?? ICONS[tone]} size={18} className="mt-px flex-shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
