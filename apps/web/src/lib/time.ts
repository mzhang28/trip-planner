import type { Instant } from '@trip/crdt';

/**
 * The zone an event is shown in.
 *
 * An event carries the zone of the place it happens, so a 09:00 booking in
 * Tokyo reads as 09:00 wherever the person looking at it happens to be. Falling
 * back to the trip's home zone rather than the device's keeps a trip consistent
 * for everyone planning it, instead of shifting depending on who opened it.
 */
export function zoneFor(eventTimezone: string | undefined, homeTimezone: string): string {
  return eventTimezone ?? homeTimezone;
}

export function formatTime(at: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at);
}

export function formatDayHeading(at: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(at);
}

/**
 * The calendar day an instant falls on, in the given zone, as `YYYY-MM-DD`.
 *
 * Grouping by this rather than by a rounded timestamp is what makes a day mean
 * the local day: 23:30 in Tokyo and 01:30 in Tokyo are different days even
 * though they are two hours apart.
 */
export function dayKey(at: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(at);
}

/**
 * Reads `HH:MM` in the given zone and returns the instant on the same day.
 *
 * Works by measuring how far the zone is from UTC at that moment and shifting
 * by it. That has to be measured at the target instant rather than assumed,
 * because the offset changes across a daylight-saving boundary.
 */
export function setTimeOfDay(at: Instant, timeZone: string, hhmm: string): Instant | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const day = dayKey(at, timeZone);
  const asUtc = Date.parse(`${day}T${String(hours).padStart(2, '0')}:${match[2]}:00Z`);

  return asUtc - offsetAt(asUtc, timeZone);
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetAt(at: Instant, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return asIfUtc - at;
}
