'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useKnownSession } from '@/lib/hooks/useKnownSession';
import AppHeader from '@/components/AppHeader';
import AuthButton from '@/components/AuthButton';
import EmptyState from '@/components/EmptyState';
import LoadError from '@/components/LoadError';
import GiftHistory from '@/components/GiftHistory';
import Button from '@/components/Button';
import { useDiscreetMode } from '@/lib/hooks/useDiscreetMode';
import { useLocalToday } from '@/lib/hooks/useLocalToday';
import { useCurrencyRates } from '@/lib/hooks/useCurrencyRates';
import { signInPath } from '@/lib/utils/callbackUrl';
import { needsPricesControl, viewerPriceCurrency } from '@/lib/utils/listPrices';
import { partitionReservations, totalInCurrency } from '@/lib/utils/reservations';
import ChangedSection from './ChangedSection';
import ReservedDialogs from './ReservedDialogs';
import ReservedSkeleton from './ReservedSkeleton';
import ReservedSummary from './ReservedSummary';
import ToGiveSection from './ToGiveSection';
import { useReservedData } from './useReservedData';

export default function BookedPage() {
  const { data: session, status } = useKnownSession();
  const router = useRouter();
  const { reservations, gifts, loading, loadFailed, retryLoad, busy, givenIds, confirms, actions } =
    useReservedData();
  // Discreet mode (WIS-46) covers the page until Show, for this visit only: the
  // state goes with the page, so the next visit is covered again. What's behind
  // the cover is still read, so Show has it ready.
  const { discreet } = useDiscreetMode();
  const [revealed, setRevealed] = useState(false);
  // Turned off, the next time it's on starts covered again, Show or not.
  useEffect(() => {
    if (!discreet) setRevealed(false);
  }, [discreet]);
  // The viewer's local date, which "To give" is grouped by: `null` until it's
  // known (see `useLocalToday`), and until then the cards aren't grouped.
  const today = useLocalToday();

  useEffect(() => {
    if (status === 'unauthenticated') router.replace(signInPath('/booked'));
  }, [status, router]);

  // The cards still to give, and the ones that changed since they were reserved.
  const { needsConfirm, active } = partitionReservations(reservations);
  // D9: prices in the viewer's own currency, as "≈" with the original under
  // them. The rates are only read once some price is in another currency.
  const viewerCurrency = viewerPriceCurrency(session?.user?.defaultCurrency);
  const rates = useCurrencyRates(
    needsPricesControl(
      [
        ...reservations.map((r) => ({ price: r.pledge ?? r.itemPrice })),
        ...gifts.map((g) => ({ price: g.itemPrice })),
      ],
      viewerCurrency
    )
  );
  // A group gift counts as the viewer's own share of it, not the whole price.
  const toGiveTotal = totalInCurrency(
    active.map((r) => r.pledge ?? r.itemPrice),
    viewerCurrency,
    rates
  );

  if (discreet && !revealed) {
    return (
      <div className="min-h-screen">
        <AppHeader actions={<AuthButton />} />
        <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Reserved by you</h1>
          <div className="mt-8">
            <EmptyState
              icon="eye-off"
              title="No spoiler mode is on"
              body="Your reservations are hidden while it is."
              actions={
                <Button variant="secondary" onClick={() => setRevealed(true)}>
                  Show
                </Button>
              }
            />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader actions={<AuthButton />} />
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Reserved by you</h1>
        <ReservedSummary
          showSummary={!loading && !loadFailed && reservations.length > 0}
          toGiveCount={active.length}
          toReviewCount={needsConfirm.length}
          toGiveTotal={toGiveTotal}
        />

        {loading ? (
          <ReservedSkeleton />
        ) : loadFailed ? (
          <div className="mt-8">
            <LoadError title="Couldn’t load your reservations" onRetry={retryLoad} />
          </div>
        ) : (
          <div className="mt-8 space-y-12">
            {reservations.length === 0 ? (
              <EmptyState
                icon="gift"
                title="Nothing reserved yet"
                body="When you reserve a gift on someone’s wishlist, it’ll show up here so you can keep track."
              />
            ) : (
              <>
                <ToGiveSection
                  active={active}
                  today={today}
                  busy={busy}
                  givenIds={givenIds}
                  viewerCurrency={viewerCurrency}
                  rates={rates}
                  onGift={confirms.setGift}
                  onRelease={actions.release}
                  onGiveGroupGift={confirms.setGroupGive}
                  onLeaveGroupGift={actions.leaveGroupGift}
                />
                {needsConfirm.length > 0 && (
                  <ChangedSection
                    needsConfirm={needsConfirm}
                    busy={busy}
                    givenIds={givenIds}
                    viewerCurrency={viewerCurrency}
                    rates={rates}
                    onGift={confirms.setGift}
                    onDismiss={actions.dismiss}
                  />
                )}
              </>
            )}

            {/* Gift history, last: what's done. */}
            {gifts.length > 0 && (
              <GiftHistory
                gifts={gifts}
                busy={busy}
                onDelete={actions.deleteGift}
                currency={viewerCurrency}
                rates={rates}
              />
            )}
          </div>
        )}
      </main>

      <ReservedDialogs confirms={confirms} actions={actions} />
    </div>
  );
}
