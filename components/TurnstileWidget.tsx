'use client';

import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';

/**
 * Cloudflare Turnstile's widget, loaded from Cloudflare's own script (it must
 * not be bundled or proxied) and rendered explicitly into this component. No
 * npm wrapper: the API is three calls. `next.config.js`'s CSP allows
 * `https://challenges.cloudflare.com` for the script and its iframe.
 *
 * Rendered with `appearance: 'interaction-only'`: in the dashboard's Managed
 * mode it stays invisible unless Cloudflare wants the visitor to click, and in
 * Invisible mode it never shows. The token it hands back is single-use and
 * expires after 5 minutes. Turnstile fetches a fresh one itself when it expires;
 * after a token is spent, the caller asks for one with `reset()`.
 *
 * The caller asks for the token when it needs it (`getToken`), rather than
 * waiting on it up front: a visitor who submits a moment after the page loads
 * waits for it then, and when the check can't produce one (Cloudflare's script
 * didn't load, or the widget errored) the caller goes ahead without one and the
 * server decides. It refuses a missing token unless Cloudflare is down for it
 * too, which is what makes a Cloudflare outage fail open instead of locking
 * everyone out (`lib/turnstile.ts`).
 */

export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileRenderOptions {
  sitekey: string;
  action?: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  size?: 'normal' | 'flexible' | 'compact';
  theme?: 'auto' | 'light' | 'dark';
  'response-field'?: boolean;
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'error-callback'?: (code: string) => void;
}

/** The slice of `window.turnstile` we use. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | null | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** The script tag while it's loading, so concurrent widgets share one. */
let scriptLoad: Promise<TurnstileApi> | null = null;

/** Load Cloudflare's script once per page, however many widgets ask for it. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptLoad) {
    const script = document.createElement('script');
    scriptLoad = new Promise<TurnstileApi>((resolve, reject) => {
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.onload = () =>
        window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load'));
      script.onerror = () => reject(new Error('Turnstile did not load'));
      document.head.appendChild(script);
    })
      .catch((error: unknown) => {
        // Drop the failed tag, so the next widget tries again (e.g. back online).
        script.remove();
        throw error;
      })
      .finally(() => {
        // Loaded, `window.turnstile` answers from now on; failed, the next call retries.
        scriptLoad = null;
      });
  }
  return scriptLoad;
}

export interface TurnstileHandle {
  /**
   * The current token, or the next one if it's on its way (waiting at most
   * `timeoutMs`). `null` when there's none to have: the check failed to load or
   * errored, or no token arrived in time (an interactive challenge left unsolved).
   */
  getToken(timeoutMs: number): Promise<string | null>;
  /** Drop the current token and fetch a fresh one: each token passes one check. */
  reset(): void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** Shown in Cloudflare's analytics; up to 32 of `[A-Za-z0-9_-]`. */
  action: string;
  /** Cloudflare's script couldn't be loaded (offline, or a content blocker). */
  onLoadError?: () => void;
  ref?: Ref<TurnstileHandle>;
}

export default function TurnstileWidget({
  siteKey,
  action,
  onLoadError,
  ref,
}: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const token = useRef<string | null>(null);
  /** No token is coming until a reset or a retry succeeds. */
  const failed = useRef(false);
  /** `getToken` calls waiting for the next token (or for a failure). */
  const waiters = useRef(new Set<(token: string | null) => void>());
  const onLoadErrorRef = useRef(onLoadError);
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  });

  useImperativeHandle(
    ref,
    () => ({
      getToken(timeoutMs) {
        if (token.current) return Promise.resolve(token.current);
        if (failed.current) return Promise.resolve(null);
        return new Promise<string | null>((resolve) => {
          const settle = (value: string | null) => {
            clearTimeout(timer);
            waiters.current.delete(settle);
            resolve(value);
          };
          const timer = setTimeout(() => settle(null), timeoutMs);
          waiters.current.add(settle);
        });
      },
      reset() {
        token.current = null;
        if (!widgetId.current) return; // never rendered: nothing to retry
        failed.current = false;
        window.turnstile?.reset(widgetId.current);
      },
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;
    const pending = waiters.current;
    /** Answer every waiting `getToken`. */
    const settleAll = (value: string | null) => {
      for (const settle of [...pending]) settle(value);
    };
    const fail = () => {
      token.current = null;
      failed.current = true;
      settleAll(null);
    };

    loadTurnstile().then(
      (turnstile) => {
        if (cancelled || !container.current) return;
        widgetId.current =
          turnstile.render(container.current, {
            sitekey: siteKey,
            action,
            appearance: 'interaction-only',
            size: 'flexible',
            theme: 'auto',
            // The token goes to the server action, not into a form field.
            'response-field': false,
            callback: (value) => {
              token.current = value;
              failed.current = false;
              settleAll(value);
            },
            // Turnstile fetches a fresh token by itself after these two.
            'expired-callback': () => {
              token.current = null;
            },
            'timeout-callback': () => {
              token.current = null;
            },
            // Turnstile retries by itself; returning nothing lets it log the code.
            'error-callback': fail,
          }) ?? null;
      },
      () => {
        if (cancelled) return;
        fail();
        onLoadErrorRef.current?.();
      }
    );
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
      token.current = null;
      failed.current = false;
      settleAll(null);
    };
  }, [siteKey, action]);

  return <div ref={container} className="empty:hidden" />;
}
