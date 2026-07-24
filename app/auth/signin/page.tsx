'use client';

import { signIn } from 'next-auth/react';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Icon from '@/components/Icon';

function SignInForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const error = searchParams?.get('error');
  const callbackUrl = searchParams?.get('callbackUrl') || '/';

  // NextAuth deliberately returns a generic error code (not the server-side
  // reason), so we can't tell a rate-limit from an SMTP failure here — this
  // message covers both, and notably stops us falsely claiming a link was sent
  // when the sign-in rate limit blocked the send.
  const SEND_FAILED_MESSAGE =
    "We couldn't send your magic link. If you've requested one a few times recently, wait a few minutes and try again.";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setSubmitError(null);

    try {
      // redirect:false → signIn resolves with { ok, error } instead of throwing,
      // so we must inspect the result rather than assume success.
      const result = await signIn('nodemailer', {
        email,
        redirect: false,
        callbackUrl,
      });
      if (result?.error) {
        setSubmitError(SEND_FAILED_MESSAGE);
      } else {
        setIsSubmitted(true);
      }
    } catch (error) {
      console.error('Error signing in:', error);
      setSubmitError(SEND_FAILED_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  };

  const bannerMessage = submitError
    ? submitError
    : error
      ? error === 'AccessDenied'
        ? 'Access denied. Please try again.'
        : 'An error occurred. Please try again.'
      : null;

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-lg">
          <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/10 text-accent dark:text-primary-400">
            <Icon name="mail" size={28} />
          </span>
          <h1 className="mb-3 text-2xl font-bold tracking-tight text-foreground">
            Check your email
          </h1>
          <p className="mb-4 text-muted-foreground">
            A sign in link has been sent to <strong className="text-foreground">{email}</strong>
          </p>
          <p className="text-sm text-muted-foreground">
            Click the link in the email to sign in. You can close this window.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-lg">
        <div className="mb-8 text-center">
          <Link
            href="/"
            className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm transition-transform hover:scale-105"
            aria-label="Wishlist home"
          >
            <Icon name="gift" size={28} />
          </Link>
          <h1 className="mb-2 text-2xl font-bold tracking-tight text-foreground">Welcome back</h1>
          <p className="text-muted-foreground">Enter your email to receive a magic link</p>
        </div>

        {bannerMessage && (
          <div
            role="alert"
            className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10"
          >
            <p className="text-sm text-red-700 dark:text-red-400">{bannerMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-2">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 border border-border-strong rounded-lg outline-none"
              placeholder="you@example.com"
              disabled={isLoading}
              autoComplete="email"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-primary-600 text-white py-3 rounded-lg font-medium hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoading ? 'Sending link...' : 'Send magic link'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          New users will automatically have an account created. No password needed!
        </p>
      </div>
    </div>
  );
}

export default function SignIn() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background px-4">
          <div className="max-w-md w-full bg-surface rounded-2xl border border-border shadow-lg p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
          </div>
        </div>
      }
    >
      <SignInForm />
    </Suspense>
  );
}
