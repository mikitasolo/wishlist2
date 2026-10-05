'use client';

import { useParams } from 'next/navigation';
import WishlistPage from '@/components/WishlistPage';

/** A list at its canonical URL, `/wishlists/<slug or id>`. The page itself is `WishlistPage`. */
export default function WishlistDetail() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : null;
  return <WishlistPage address={id ? { kind: 'slug', id } : null} />;
}
