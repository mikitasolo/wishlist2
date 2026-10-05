import Link from 'next/link';
import EmptyState from '@/components/EmptyState';
import { buttonClassName } from '@/components/buttonStyles';

/**
 * What a share link's page (`/l/<token>`, WIS-335) shows when the link is dead:
 * unknown, revoked, expired, its list archived or deleted, or refused for any
 * other reason. One state, worded the same for every reason and every viewer
 * (signed in or not, owners included), so it never tells why. Unlike a list's
 * own unavailable state it offers no Sign in: signing in doesn't bring a dead
 * link back.
 */
export default function ShareLinkUnavailable() {
  return (
    <EmptyState
      framed={false}
      icon="link-off"
      level={1}
      title="This link doesn’t work anymore"
      body="Ask the person who sent it for a new one."
      actions={
        <Link href="/" className={buttonClassName({ variant: 'secondary' })}>
          Go home
        </Link>
      }
    />
  );
}
