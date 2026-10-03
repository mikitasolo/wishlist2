/** Activity: notifications, with pending invitations pinned above them. */
export const ACTIVITY_PATH = '/notifications';

/**
 * Activity's address with the query an old Invitations link (`/invites?…`)
 * was opened with, so nothing it carries is lost on the way. A key given more
 * than once keeps every value, in order.
 */
export function activityPath(params: Record<string, string | string[] | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
  }
  const search = query.toString();
  return search ? `${ACTIVITY_PATH}?${search}` : ACTIVITY_PATH;
}
