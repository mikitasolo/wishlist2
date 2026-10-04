/**
 * What a person types to confirm deleting their account (WIS-276): their
 * username, or their email when they have no username. Shared by the Settings
 * dialog, which only enables Delete once it matches, and `DELETE
 * /api/users/me`, which refuses anything else.
 */

export interface DeletionConfirmationTarget {
  kind: 'username' | 'email';
  value: string;
}

export function deletionConfirmationTarget(user: {
  username?: string | null;
  email?: string | null;
}): DeletionConfirmationTarget {
  const username = user.username?.trim();
  if (username) return { kind: 'username', value: username };
  return { kind: 'email', value: (user.email ?? '').trim() };
}

/**
 * Whether `typed` confirms the deletion: the target, ignoring case and the space
 * around it, and for a username an `@` in front. Never true for an empty target.
 */
export function matchesDeletionConfirmation(
  typed: unknown,
  target: DeletionConfirmationTarget
): boolean {
  if (typeof typed !== 'string' || !target.value) return false;
  let input = typed.trim();
  if (target.kind === 'username' && input.startsWith('@')) input = input.slice(1);
  return input.toLowerCase() === target.value.toLowerCase();
}
