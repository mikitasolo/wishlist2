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
  /** Drop the current token and get a fresh one: each token passes one check. */
  reset(): void;
}

interface TurnstileWidgetProps {
  siteKey: string;
  /** Shown in Cloudflare's analytics; up to 32 of `[A-Za-z0-9_-]`. */
  action: string;
  /** A token when the check passes; `null` when it expires, errors or is reset. */
  onToken: (token: string | null) => void;
  /** Cloudflare's script couldn't be loaded (offline, or a content blocker). */
  onLoadError?: () => void;
  ref?: Ref<TurnstileHandle>;
}

export default function TurnstileWidget({
  siteKey,
  action,
  onToken,
  onLoadError,
  ref,
}: TurnstileWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  // The widget is rendered once per site key; its callbacks read the latest props.
  const callbacks = useRef({ onToken, onLoadError });
  useEffect(() => {
    callbacks.current = { onToken, onLoadError };
  });

  useImperativeHandle(
    ref,
    () => ({
      reset() {
        callbacks.current.onToken(null);
        if (widgetId.current) window.turnstile?.reset(widgetId.current);
      },
    }),
    []
  );

  useEffect(() => {
    let cancelled = false;
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
            callback: (token) => callbacks.current.onToken(token),
            'expired-callback': () => callbacks.current.onToken(null),
            'timeout-callback': () => callbacks.current.onToken(null),
            // Turnstile retries by itself; returning nothing lets it log the code.
            'error-callback': () => callbacks.current.onToken(null),
          }) ?? null;
      },
      () => {
        if (!cancelled) callbacks.current.onLoadError?.();
      }
    );
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  return <div ref={container} className="empty:hidden" />;
}
