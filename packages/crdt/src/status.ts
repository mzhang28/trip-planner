/**
 * Whether an event is still flexible or confirmed.
 *
 * This lives in the data package rather than the UI one because it is a
 * property of an event, not a way of drawing it. The card spine, the map pin,
 * and the status chip all read from here, which is what keeps a pin and its
 * card showing the same thing.
 */
export const BOOKING_STATUSES = ['idea', 'booked'] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** The product vocabulary for booking states, shared by every interface. */
export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  idea: 'Flexible',
  booked: 'Confirmed',
};

/** Ordered least to most fixed. Merging two events keeps the higher one. */
export const BOOKING_STATUS_RANK: Record<BookingStatus, number> = {
  idea: 0,
  booked: 1,
};

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/**
 * Maps the removed intermediate state to Flexible when an older replica sends
 * one. New writes can only contain one of the two current states.
 */
export function normalizeBookingStatus(value: unknown): BookingStatus {
  return value === 'booked' ? 'booked' : 'idea';
}

/** Returns whichever status is more fixed. */
export function higherStatus(a: BookingStatus, b: BookingStatus): BookingStatus {
  const normalizedA = normalizeBookingStatus(a);
  const normalizedB = normalizeBookingStatus(b);
  return BOOKING_STATUS_RANK[normalizedA] >= BOOKING_STATUS_RANK[normalizedB]
    ? normalizedA
    : normalizedB;
}
