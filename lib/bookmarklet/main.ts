import { runBookmarklet } from './run';
import { APP_ORIGIN_PLACEHOLDER } from './placeholder';

/** The bookmarklet's entry: `href.ts` swaps the placeholder for the real origin. */
runBookmarklet(window, APP_ORIGIN_PLACEHOLDER);
