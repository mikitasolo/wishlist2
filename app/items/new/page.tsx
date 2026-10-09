'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import AddFromLinkFlow from '@/components/AddFromLinkFlow';
import Spinner from '@/components/Spinner';
import { signInPath } from '@/lib/utils/callbackUrl';
import { parseProductFragment, type ProductPrefill } from '@/lib/utils/productFragment';

/**
 * Where the bookmarklet (WIS-367) and a later extension land (WIS-365): the
 * product they read off a store's page is in the URL's fragment, so it never
 * reaches our server or logs. Once signed in, the fragment is read once and
 * stripped from the address, and the visitor picks a list and reviews the
 * prefilled form (`AddFromLinkFlow`): nothing is saved until they press a
 * button. A fragment with nothing usable opens the plain add flow, with no
 * error. Signed out, the fragment goes along through the sign-in redirect.
 */
export default function NewItemFromLinkPage() {
  const { data: session, status } = useKnownSession();
  const router = useRouter();
  // undefined until the fragment has been read; null when it held nothing usable.
  const [product, setProduct] = useState<ProductPrefill | null | undefined>(undefined);

  // The fragment is read once: StrictMode runs the effect twice, and the second
  // run would see the address already stripped.
  const read = useRef(false);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(signInPath('/items/new', window.location.hash));
      return;
    }
    if (status !== 'authenticated' || read.current) return;
    read.current = true;
    setProduct(parseProductFragment(window.location.hash));
    // The product is out of the address bar and the history entry once read.
    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [status, router]);

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Add an item</h1>
        <p className="mt-1 text-muted-foreground">
          Pick a wishlist, check the details, then add it.
        </p>
        {product === undefined && (
          <div className="mt-8 flex justify-center">
            <Spinner size="lg" />
          </div>
        )}
      </main>
      {product !== undefined && (
        <AddFromLinkFlow product={product} userCurrency={session?.user?.defaultCurrency} />
      )}
    </div>
  );
}
