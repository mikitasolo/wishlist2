/**
 * Stands in for the app's origin in the built bookmarklet code. The Settings
 * card swaps it for `window.location.origin`, so one committed build serves
 * production, staging and every local dev port, with no build-time env.
 */
export const APP_ORIGIN_PLACEHOLDER = '__WISHLIST_APP_ORIGIN__';
