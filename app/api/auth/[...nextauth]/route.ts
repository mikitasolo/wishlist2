import { NextResponse, type NextRequest } from 'next/server';
import { handlers } from '@/lib/auth';
import { isMagicLinkSignInPath } from '@/lib/signInEmail';

// NextAuth v5 exposes the route handlers directly.
export const { GET } = handlers;

/**
 * Auth.js's POST handler, minus its sign-in action. A magic link is only sent
 * through the sign-in form's server action (`app/auth/signin/actions.ts`), which
 * checks the Turnstile token first. Left open, `POST /api/auth/signin/nodemailer`
 * (with a token from `/api/auth/csrf`) would send one past that check. It's
 * refused here before Auth.js runs at all, so it doesn't create the account
 * either. Sign-out, the session update and the email link's callback still pass.
 */
export async function POST(request: NextRequest) {
  if (isMagicLinkSignInPath(request.nextUrl.pathname)) {
    return NextResponse.json({ error: 'Sign in from the sign-in page.' }, { status: 403 });
  }
  return handlers.POST(request);
}
