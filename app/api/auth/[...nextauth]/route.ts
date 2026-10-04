import { NextResponse, type NextRequest } from 'next/server';
import { handlers } from '@/lib/auth';
import { getEnvVars } from '@/lib/env';
import { isMagicLinkSignInPath } from '@/lib/signInEmail';
import { verificationErrorLocation } from '@/lib/utils/authErrorRedirect';

/**
 * Auth.js's GET handler, plus the destination on an expired magic link. When
 * Auth.js refuses the link's callback (expired or used) it redirects to
 * `/auth/error?error=Verification` without the link's `callbackUrl`, so the
 * error page's Try again would lose the page the link was for. That redirect
 * gets the `callbackUrl` added, kept only through `safeCallbackPath`
 * (`verificationErrorLocation`). Every other response passes as Auth.js gave it.
 */
export async function GET(request: NextRequest) {
  const response = await handlers.GET(request);
  const location = verificationErrorLocation(
    request.nextUrl,
    response.headers.get('Location'),
    new URL(getEnvVars().NEXTAUTH_URL).origin
  );
  if (!location) return response;
  // `Response.redirect`'s headers are immutable, so the redirect is rebuilt
  // with a copy of them (cookies included) and the new Location.
  const headers = new Headers(response.headers);
  headers.set('Location', location);
  return new Response(null, { status: response.status, headers });
}

/**
 * Auth.js's POST handler, minus its sign-in action. A magic link is only sent
 * through the sign-in form's server action (`app/auth/signin/actions.ts`), which
 * checks the Turnstile token first. Left open, `POST /api/auth/signin/nodemailer`
 * (with a token from `/api/auth/csrf`) would send one past that check. It's
 * refused here before Auth.js runs at all. Sign-out, the session update and the email link's callback still pass.
 */
export async function POST(request: NextRequest) {
  if (isMagicLinkSignInPath(request.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Sign in from the sign-in page.' }, { status: 403 });
  }
  return handlers.POST(request);
}
