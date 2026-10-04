import Link from 'next/link';
import Icon from '@/components/Icon';
import { buttonClassName } from '@/components/buttonStyles';
import { getEnvVars } from '@/lib/env';
import { signInRetryPath } from '@/lib/utils/signInForm';
import { TONE_CLASSES } from '@/lib/utils/statusTones';

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: 'There is a problem with the server configuration.',
  AccessDenied: 'You do not have permission to sign in.',
  Verification: 'Each sign-in link works once, for a limited time. Send yourself a new one.',
  Default: 'An error occurred during sign in.',
};

const ERROR_TITLES: Record<string, string> = {
  Verification: 'That sign-in link has expired',
  Default: 'Authentication error',
};

interface AuthErrorProps {
  searchParams: Promise<{ error?: string | string[]; callbackUrl?: string | string[] }>;
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Auth.js's error page (`pages.error`). Try again goes back to sign in with the
 * `callbackUrl` it was given, when there is one, so someone whose old link
 * came from a shared list still lands on it. It's kept only through
 * `safeCallbackPath`: a path on this site, never an auth page.
 */
export default async function AuthError({ searchParams }: AuthErrorProps) {
  const query = await searchParams;
  const error = first(query.error);
  const title = (error && ERROR_TITLES[error]) || ERROR_TITLES.Default;
  const message = (error && ERROR_MESSAGES[error]) || ERROR_MESSAGES.Default;
  const retry = signInRetryPath(
    first(query.callbackUrl),
    new URL(getEnvVars().NEXTAUTH_URL).origin
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
        <span
          className={`mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl ${TONE_CLASSES.danger.tint}`}
        >
          <Icon name="alert" size={28} />
        </span>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link href={retry} className={buttonClassName()}>
          Try again
        </Link>
      </div>
    </div>
  );
}
