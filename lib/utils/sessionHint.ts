/**
 * Whether this browser was signed in last time it looked, so the header can
 * hold the right shape while the session loads (WIS-209, WIS-251).
 *
 * The session is read in the browser after the first paint (`useSession`), so
 * every page starts out not knowing who's there, and the signed-in header (the
 * nav links, the account menu, the tab bar) is a different shape from the
 * signed-out one (Sign in). Whichever the loading header guessed, the other
 * kind of visitor saw the row jump when it was replaced. The session cookie is
 * httpOnly, so the page can't look at it, and reading the session on the server
 * would make every page dynamic. Instead the browser remembers the answer
 * (`localStorage`, a bare flag: nothing about who), and an inline script in the
 * root layout puts it on `<html>` before the first paint, as the theme's does.
 * The header's placeholders draw the signed-in shape under it (the
 * `session-hint:` variant, globals.css) and the signed-out one otherwise.
 *
 * So the row only moves when the guess was wrong: once in a browser that has
 * never been signed in here and now is (the first page after a magic link), and
 * once after a session ended somewhere else (it expired, or signed out in
 * another browser). Either way the flag is put right when the session lands.
 * (A session read that fails reads as signed out to next-auth, so it clears
 * the flag too, costing the next load one jump.) Signing out from the account
 * menu clears it before the page reloads (`AuthButton`).
 */
export const SESSION_HINT_KEY = 'session-hint';
export const SESSION_HINT_ATTRIBUTE = 'data-session-hint';

/** Run inline in `<head>`, before paint: copies the remembered flag onto `<html>`. */
export const SESSION_HINT_SCRIPT = `try{if(localStorage.getItem('${SESSION_HINT_KEY}')==='1')document.documentElement.setAttribute('${SESSION_HINT_ATTRIBUTE}','')}catch(e){}`;

/**
 * Records what the session turned out to be, for the next page load and for
 * this one (an `update()` puts the session back through loading). Storage
 * that can't be written (a private window) only costs the guess.
 */
export function rememberSessionHint(signedIn: boolean): void {
  const root = document.documentElement;
  if (signedIn) root.setAttribute(SESSION_HINT_ATTRIBUTE, '');
  else root.removeAttribute(SESSION_HINT_ATTRIBUTE);
  try {
    if (signedIn) localStorage.setItem(SESSION_HINT_KEY, '1');
    else localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* no storage: the next load guesses signed out */
  }
}
