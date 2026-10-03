import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

// A test that moves the URL (a list's tabs push `?tab=`) mustn't leave the
// next one starting there: jsdom keeps one window per file.
afterEach(() => {
  if (typeof window !== 'undefined') window.history.replaceState(null, '', '/');
});
