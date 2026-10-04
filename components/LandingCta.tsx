'use client';

import { signIn } from 'next-auth/react';
import Button from '@/components/Button';

/** The landing page's one call to action: sign-in, where a new account is made. */
export default function LandingCta() {
  return (
    <Button size="xl" shape="pill" onClick={() => signIn()}>
      Create your wishlist
    </Button>
  );
}
