/**
 * How far along a booking is.
 *
 * This lives in the data package rather than the UI one because it is a
 * property of an event, not a way of drawing it. The card spine, the map pin,
 * and the status chip all read from here, which is what keeps a pin and its
 * card showing the same thing.
 */
export const BOOKING_STATUSES = ['idea', 'in_progress', 'booked'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Ordered least to most settled. Merging two events keeps the higher one. */
export const BOOKING_STATUS_RANK: Record<BookingStatus, number> = {
  idea: 0,
  in_progress: 1,
  booked: 2,
};

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/** Returns whichever status is further along. */
export function higherStatus(a: BookingStatus, b: BookingStatus): BookingStatus {
  return BOOKING_STATUS_RANK[a] >= BOOKING_STATUS_RANK[b] ? a : b;
}
