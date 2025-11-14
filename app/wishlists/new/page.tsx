'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NewWishlist() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to home page - wishlist creation is now done via modal
    router.push('/');
  }, [router]);

  return null;
}

