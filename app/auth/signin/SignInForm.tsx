'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Icon from '@/components/Icon';
import TurnstileWidget, { type TurnstileHandle } from '@/components/TurnstileWidget';
import { requestMagicLink } from './actions';
import Button from '@/components/Button';
import Callout from '@/components/Callout';
import Field from '@/components/Field';
import Input from '@/components/Input';
import {
  emailInputError,
  RESEND_DELAY_MS,
  signInSubtitle,
  type SignInDestination,
} from '@/lib/utils/signInForm';

// Auth.js deliberately returns a generic error code (not the server-side
// reason), so we can't tell a rate-limit from an SMTP failure here — this
// message covers both, and notably stops us falsely claiming a link was sent
// when the sign-in rate limit blocked the send.
export const SEND_FAILED_MESSAGE =
  "We couldn't send your magic link. If you've requested one a few times recently, wait a few minutes and try again.";

/** The Turnstile check refused the token (or it never got one). */
export const CHALLENGE_FAILED_MESSAGE = 'Please complete the check and try again.';

/**
 * How long a submit waits for the Turnstile token. The invisible check usually
 * has it ready a second or two after the page loads, so this only matters for a
 * very quick submit or an interactive challenge, which the visitor can still
 * solve meanwhile. Past it the form sends without a token and the server decides.
 */
export const TOKEN_WAIT_MS = 10_000;

export const CHALLENGE_LOAD_FAILED_MESSAGE =
  "The security check couldn't load. Check your connection (or allow challenges.cloudflare.com in your content blocker) and reload the page.";

/** Shown on the link-sent card once a resend has gone out. */
export const RESENT_MESSAGE = 'We sent you another link.';

interface SignInFormProps {
  /** Set only while Turnstile is on (both keys configured): renders the widget. */
  turnstileSiteKey?: string;
  /**
   * Where signing in continues to, worked out by the page from the callback's
   * path alone (`signInDestination`): the hint stays generic, so it never
   * names a list or a person.
   */
  destination?: SignInDestination;
}

export default function SignInForm({ turnstileSiteKey, destination = null }: SignInFormProps) {
  const [email, setEmail] = useState('');
  // The inline error shows once a submit has been tried, then follows the field.
  const [attempted, setAttempted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // The address the last link went to, as the person typed it (trimmed): only
  // ever shown back to them, on their own screen.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const [resendReadyAt, setResendReadyAt] = useState(0);
  const [now, setNow] = useState(0);
  const [focusEmail, setFocusEmail] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [checkLoadFailed, setCheckLoadFailed] = useState(false);
  const turnstile = useRef<TurnstileHandle>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const searchParams = useSearchParams();
  const error = searchParams?.get('error');
  const callbackUrl = searchParams?.get('callbackUrl') || '/';

  const emailError = attempted ? emailInputError(email) : null;
  const resendIn = Math.max(0, Math.ceil((resendReadyAt - now) / 1000));

  // Counts Resend link down from the time of the last send (not by ticks), so
  // a throttled background tab can't hold it back any longer than that.
  useEffect(() => {
    if (resendReadyAt === 0) return;
    const tick = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (at >= resendReadyAt) clearInterval(tick);
    }, 1000);
    return () => clearInterval(tick);
  }, [resendReadyAt]);

  // Back from the link-sent card: straight into the field, which kept its address.
  useEffect(() => {
    if (focusEmail) emailInput.current?.focus();
  }, [focusEmail]);

  /**
   * Ask the server action for a link: the first send and every resend. Each
   * goes through `requestMagicLink` with a fresh Turnstile token, so a resend
   * passes the same check and spends the same sign-in rate limits.
   */
  const send = async (address: string): Promise<boolean> => {
    let turnstileToken: string | null = null;
    try {
      // Turnstile on: wait for its token if it isn't there yet. Without one
      // (the check couldn't load or run) the server decides: it refuses unless
      // Cloudflare is down, so an outage doesn't lock everyone out.
      if (turnstileSiteKey) {
        turnstileToken = (await turnstile.current?.getToken(TOKEN_WAIT_MS)) ?? null;
      }
      const result = await requestMagicLink({ email: address, callbackUrl, turnstileToken });
      if (result.ok) return true;
      setSubmitError(
        result.error !== 'challenge'
          ? SEND_FAILED_MESSAGE
          : checkLoadFailed
            ? CHALLENGE_LOAD_FAILED_MESSAGE
            : CHALLENGE_FAILED_MESSAGE
      );
      return false;
    } catch (error) {
      console.error('Error signing in:', error);
      setSubmitError(SEND_FAILED_MESSAGE);
      return false;
    } finally {
      // A token we sent is spent (or was refused): fetch a fresh one for the
      // next send. Without one there's nothing to replace, and a reset would
      // throw away an interactive challenge the visitor may be halfway through.
      if (turnstileToken) turnstile.current?.reset();
    }
  };

  const startResendWait = () => {
    const at = Date.now();
    setNow(at);
    setResendReadyAt(at + RESEND_DELAY_MS);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;
    setAttempted(true);
    setFocusEmail(false);
    if (emailInputError(email)) {
      emailInput.current?.focus();
      return;
    }
    const address = email.trim();
    setIsLoading(true);
    setSubmitError(null);
    const sent = await send(address);
    setIsLoading(false);
    if (sent) {
      setSentTo(address);
      setResent(false);
      startResendWait();
    }
  };

  const handleResend = async () => {
    if (isLoading || !sentTo || resendIn > 0) return;
    setIsLoading(true);
    setSubmitError(null);
    setResent(false);
    const sent = await send(sentTo);
    setIsLoading(false);
    if (sent) {
      setResent(true);
      startResendWait();
    }
  };

  const handleUseDifferentEmail = () => {
    setSentTo(null);
    setSubmitError(null);
    setResent(false);
    setFocusEmail(true);
  };

  const bannerMessage = submitError
    ? submitError
    : error
      ? error === 'AccessDenied'
        ? 'Access denied. Please try again.'
        : 'An error occurred. Please try again.'
      : null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-lg">
        {sentTo ? (
          <div className="text-center">
            <span className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/12 text-accent">
              <Icon name="mail" size={28} />
            </span>
            <h1 className="mb-3 text-3xl font-semibold tracking-tight text-foreground">
              Check your email
            </h1>
            <p className="mb-2 text-muted-foreground">
              Sent to <strong className="break-all text-foreground">{sentTo}</strong>
            </p>
            <p className="mb-6 text-sm text-muted-foreground">
              Open the link in it to sign in. You can close this window.
            </p>

            {submitError && (
              <Callout tone="danger" className="mb-6 text-left">
                {submitError}
              </Callout>
            )}
            <p role="status" className="mb-3 text-sm text-muted-foreground empty:hidden">
              {resent ? RESENT_MESSAGE : ''}
            </p>

            <div className="flex flex-col gap-3">
              <Button
                variant="secondary"
                fullWidth
                disabled={isLoading || resendIn > 0}
                onClick={handleResend}
              >
                {isLoading
                  ? 'Sending link…'
                  : resendIn > 0
                    ? `Resend link in ${resendIn}s`
                    : 'Resend link'}
              </Button>
              <Button
                variant="ghost"
                fullWidth
                disabled={isLoading}
                onClick={handleUseDifferentEmail}
              >
                Use a different email
              </Button>
            </div>

            <p className="mt-6 text-sm text-muted-foreground">
              Can&apos;t find it? Check your spam folder.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-8 text-center">
              <Link
                href="/"
                className="mb-5 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 text-white shadow-sm transition-transform hover:scale-105"
                aria-label="Wishlist home"
              >
                <Icon name="gift" size={28} />
              </Link>
              <h1 className="mb-2 text-3xl font-semibold tracking-tight text-foreground">
                Sign in or create an account
              </h1>
              <p className="text-muted-foreground">{signInSubtitle(destination)}</p>
            </div>

            {bannerMessage && (
              <Callout tone="danger" className="mb-6">
                {bannerMessage}
              </Callout>
            )}

            <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off" noValidate>
              <Field label="Email address" id="email" error={emailError ?? undefined}>
                <Input
                  ref={emailInput}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  disabled={isLoading}
                  autoComplete="email"
                />
              </Field>

              <Button type="submit" disabled={isLoading} fullWidth>
                {isLoading ? 'Sending link…' : 'Send magic link'}
              </Button>
            </form>
          </>
        )}

        {/* One widget for both views, so a resend gets its fresh token from the
            same check. Invisible unless Cloudflare wants a click. */}
        {turnstileSiteKey && (
          <div className="[&>div:not(:empty)]:mt-6">
            <TurnstileWidget
              ref={turnstile}
              siteKey={turnstileSiteKey}
              action="signin"
              onLoadError={() => {
                setCheckLoadFailed(true);
                setSubmitError(CHALLENGE_LOAD_FAILED_MESSAGE);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
