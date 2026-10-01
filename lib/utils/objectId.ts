import mongoose from 'mongoose';

/**
 * Whether a route param has the shape of an ObjectId: 24 hex characters.
 *
 * A param that doesn't can't match any record, but passing it to `findById` or a
 * query on an ObjectId field throws a CastError, which a route's catch-all turns
 * into a 500. Check it first, and answer exactly what the route answers for an id
 * that matches nothing (usually its "not found" 404). Check it *after* the route's
 * auth and access checks, so a malformed id tells a caller nothing more than an
 * authorization failure would.
 */
export function isObjectIdParam(param: string): boolean {
  return mongoose.isObjectIdOrHexString(param);
}
