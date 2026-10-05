import type { Model } from 'mongoose';
import { createMigration } from '@/lib/utils/migration';
import Item from '@/models/Item';
import Reservation from '@/models/Reservation';
import GiftLog from '@/models/GiftLog';

/**
 * Uppercases one price field's currency code wherever it holds a lowercase
 * letter, and returns how many rows it rewrote. One pipeline update, so each row
 * is rewritten from its own stored value (never from a copy read earlier), and
 * only a code that still has a lowercase letter is touched. It goes through the
 * driver (`Model.collection`) so it doesn't stamp `updatedAt`: an item's
 * `updatedAt` is the version an open edit is saved against, and this doesn't
 * change what the item is.
 */
async function uppercase(model: Pick<Model<unknown>, 'collection'>, field: string) {
  const result = await model.collection.updateMany(
    { [field]: { $type: 'string', $regex: /[a-z]/ } },
    [{ $set: { [field]: { $toUpper: `$${field}` } } }]
  );
  return result.modifiedCount;
}

/**
 * POST /api/migrations/uppercase-currency-codes (WIS-49)
 *
 * Item prices used to store their currency code lowercase ("eur", the rates
 * API's format), and so did the booking snapshots copied from them
 * (`Reservation` and `GiftLog` `itemPrice`), while `Wishlist.currency` and
 * `User.defaultCurrency` are uppercase. Every code is now stored uppercase (ISO
 * 4217): new writes already are, and every reader compares codes through
 * `normalizeCurrency`, so both casings work meanwhile. This rewrites the old
 * rows: `Item.price.currency`, `Reservation.itemPrice.currency` and
 * `GiftLog.itemPrice.currency`. Nothing else is read or written, and the
 * response carries only counts.
 *
 * Idempotent: only a code with a lowercase letter matches, so a re-run (or a
 * row written uppercase in between) changes nothing, and a partial run is
 * finished by running it again.
 *
 * Deploy ordering: run it only **after** the code that reads both casings (the
 * WIS-49 PR) is deployed, on staging and then on production. The code before it
 * looks rates up with the stored code as it is, so an uppercased price would
 * stop converting on a deployment still running it. Once it has run everywhere,
 * the follow-up cleanup deletes this endpoint and the lowercase tolerance.
 */
export const POST = createMigration(async () => {
  const items = await uppercase(Item, 'price.currency');
  const reservations = await uppercase(Reservation, 'itemPrice.currency');
  const giftLogs = await uppercase(GiftLog, 'itemPrice.currency');
  return { items, reservations, giftLogs };
});
