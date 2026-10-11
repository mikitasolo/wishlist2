import { breadcrumbsIntegration, captureException, init } from '@sentry/browser';
import { sharedSentryOptions } from './config';

/**
 * The browser SDK and its setup, loaded only through the dynamic import in
 * `./browser.ts`, so none of this (the SDK, the options, the scrub) is in any
 * page's up-front JavaScript. Named imports, never the package's namespace,
 * so the bundler leaves session replay, feedback and tracing out of the chunk.
 */

export { captureException };

/**
 * Starts the SDK. Uncaught errors and unhandled rejections are then reported
 * by its global handlers. Integrations left out: DOM breadcrumbs (a click's
 * selector can carry a person's name, from an avatar's alt text say) and
 * session tracking (errors only).
 */
export function start(dsn: string, release?: string): void {
  init({
    ...sharedSentryOptions(dsn, release),
    integrations: (defaults) => [
      ...defaults.filter((i) => i.name !== 'Breadcrumbs' && i.name !== 'BrowserSession'),
      breadcrumbsIntegration({ dom: false }),
    ],
  });
}
