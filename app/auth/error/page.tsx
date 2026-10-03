'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import Icon from '@/components/Icon';
import { buttonClassName } from '@/components/buttonStyles';
import Spinner from '@/components/Spinner';

function AuthErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams?.get('error');

  const errorMessages: Record<string, string> = {
    Configuration: 'There is a problem with the server configuration.',
    AccessDenied: 'You do not have permission to sign in.',
    Verification: 'The sign in link is no longer valid. It may have been used already or expired.',
    Default: 'An error occurred during sign in.',
  };

  const errorMessage = error
    ? errorMessages[error] || errorMessages.Default
    : errorMessages.Default;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
        <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/12 text-red-600 dark:text-red-400">
          <Icon name="alert" size={28} />
        </span>
        <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">
          Authentication error
        </h1>
        <p className="mb-6 text-muted-foreground">{errorMessage}</p>
        <Link href="/auth/signin" className={buttonClassName()}>
          Try again
        </Link>
      </div>
    </div>
  );
}

export default function AuthError() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="max-w-md w-full bg-surface rounded-2xl border border-border shadow-lg p-8 text-center">
            <Spinner size="lg" />
          </div>
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  );
}
