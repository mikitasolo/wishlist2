import { redirect } from 'next/navigation';
import { activityPath } from '@/lib/utils/activityPath';

/**
 * Invitations moved into Activity (`/notifications`), pinned above its feed.
 * This address stays, because invite emails link to it and sign-in carries it
 * as a `callbackUrl`: it sends them on to Activity, query and all. A server
 * redirect, so a signed-out visitor is sent on before anything renders, and
 * Activity sends them to sign in and back to itself.
 */
export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(activityPath(await searchParams));
}
