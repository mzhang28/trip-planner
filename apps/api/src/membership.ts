import { tripMembers, trips } from '@trip/schema';
import { and, eq } from 'drizzle-orm';
import type { Membership } from './context';
import type { Db } from './db';

/**
 * Why a person was turned away from a trip.
 *
 * A trip that is not there is worth saying, and it is not a leak: a trip id is
 * sixteen random bytes, so anyone asking about one either had it or is not
 * going to find it by asking. Answering "not yours" for an address that names
 * nothing sent people looking for access they never needed.
 */
export type MembershipRefusal = 'no_such_trip' | 'not_a_member';

/**
 * Resolves what this person may do with this trip.
 *
 * Reads the membership table and never a share token. A token is one way to
 * acquire a membership, and a future sign-in will be another; deciding access
 * from the membership means nothing downstream has to know which was used.
 */
export function lookupMembership(
  db: Db,
  tripId: string,
  userId: string,
): Membership | MembershipRefusal {
  const row = db
    .select({ role: tripMembers.role })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, userId)))
    .get();

  if (row) return { tripId, userId, role: row.role };

  const exists = db.select({ id: trips.id }).from(trips).where(eq(trips.id, tripId)).get();
  return exists ? 'not_a_member' : 'no_such_trip';
}
