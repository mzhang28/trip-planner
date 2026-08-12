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

/** Whether the browser can format a time in this zone. */
export function isTimeZone(candidate: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: candidate });
    return true;
  } catch {
    return false;
  }
}

let cachedZones: string[] | null = null;

/**
 * Every zone the browser knows, for a field to offer while somebody types.
 *
 * There are around 400 of them and the list never changes during a visit, so it
 * is worked out once. Browsers without `supportedValuesOf` get nothing offered
 * and can still type a zone, which is checked either way.
 */
export function knownTimeZones(): string[] {
  if (cachedZones) return cachedZones;

  const supported = (Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;

  cachedZones = supported ? supported('timeZone') : [];
  return cachedZones;
}

const FRIENDLY_ZONE_NAMES: Record<string, Array<[offsetMinutes: number, name: string]>> = {
  'America/New_York': [
    [-300, 'EST'],
    [-240, 'EDT'],
  ],
  'America/Chicago': [
    [-360, 'CST'],
    [-300, 'CDT'],
  ],
  'America/Denver': [
    [-420, 'MST'],
    [-360, 'MDT'],
  ],
  'America/Los_Angeles': [
    [-480, 'PST'],
    [-420, 'PDT'],
  ],
  'America/Anchorage': [
    [-540, 'AKST'],
    [-480, 'AKDT'],
  ],
  'Pacific/Honolulu': [[-600, 'HST']],
  'Asia/Tokyo': [[540, 'JST']],
  'Asia/Seoul': [[540, 'KST']],
  'Asia/Shanghai': [[480, 'CST']],
  'Asia/Hong_Kong': [[480, 'HKT']],
  'Asia/Singapore': [[480, 'SGT']],
  'Asia/Kolkata': [[330, 'IST']],
  'Europe/London': [
    [0, 'GMT'],
    [60, 'BST'],
  ],
  'Europe/Paris': [
    [60, 'CET'],
    [120, 'CEST'],
  ],
  'Europe/Berlin': [
    [60, 'CET'],
    [120, 'CEST'],
  ],
  'Australia/Sydney': [
    [600, 'AEST'],
    [660, 'AEDT'],
  ],
  'Australia/Adelaide': [
    [570, 'ACST'],
    [630, 'ACDT'],
  ],
  'Australia/Perth': [[480, 'AWST']],
  'Pacific/Auckland': [
    [720, 'NZST'],
    [780, 'NZDT'],
  ],
};

/** The short name people expect to see beside a clock, such as JST or GMT+9. */
export function timeZoneAbbreviation(at: Instant, timeZone: string): string {
  const friendly = FRIENDLY_ZONE_NAMES[timeZone]?.find(
    ([offsetMinutes]) => offsetMinutes === Math.round(offsetAt(at, timeZone) / 60_000),
  )?.[1];
  if (friendly) return friendly;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(at);

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

/** All familiar short names accepted when searching for a zone. */
export function timeZoneSearchAbbreviations(at: Instant, timeZone: string): string[] {
  return [
    timeZoneAbbreviation(at, timeZone),
    ...(FRIENDLY_ZONE_NAMES[timeZone]?.map(([, name]) => name) ?? []),
  ];
}

export function formatTime(at: Instant, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at);
}

/** A stored minute count as the hours and minutes a person plans with. */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts = [
    hours > 0 ? `${hours} hr` : undefined,
    remainder > 0 ? `${remainder} min` : undefined,
  ];
  return parts.filter(Boolean).join(' ') || '0 min';
}

export function formatDayHeading(
  at: Instant,
  timeZone: string,
  locale?: string | string[],
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  })
    .format(at)
    .replace(/,\s*/g, ' ');
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

/**
 * Reads an end clock relative to a start.
 *
 * An end earlier than (or equal to) the start means the following day. This
 * lets an event end after midnight without requiring a second date.
 */
export function endTimeFromClock(
  startsAt: Instant,
  timeZone: string,
  hhmm: string,
): Instant | null {
  const sameDay = setTimeOfDay(startsAt, timeZone, hhmm);
  if (sameDay === null || sameDay > startsAt) return sameDay;

  const day = new Date(`${dayKey(startsAt, timeZone)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  const nextDay = moveToDay(startsAt, timeZone, day.toISOString().slice(0, 10));
  return nextDay === null ? null : setTimeOfDay(nextDay, timeZone, hhmm);
}

/**
 * Moves an instant onto another calendar day, keeping its time of day.
 *
 * Dragging an event from Tuesday to Thursday should leave a 09:00 booking at
 * 09:00, not shift it by exactly 48 hours — which would land it at 08:00 or
 * 10:00 whenever a daylight-saving change falls in between.
 */
export function moveToDay(at: Instant, timeZone: string, targetDay: string): Instant | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDay)) return null;

  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(at);

  const asUtc = Date.parse(`${targetDay}T${time}:00Z`);
  if (Number.isNaN(asUtc)) return null;

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

/** The calendar day of an instant in a zone, as a `YYYY-MM-DD` input value. */
export function toDateInput(at: Instant, timeZone: string): string {
  return dayKey(at, timeZone);
}

/**
 * Puts an instant on a given calendar day, keeping its time of day.
 *
 * An event with no time yet lands at midnight, and the event records that its
 * time is undecided. The instant then does nothing but name the day, which is
 * the whole of what has been decided. It used to land at midday, so picking a
 * Thursday produced an event that said it started at 12:00.
 */
export function setDay(at: Instant | undefined, timeZone: string, day: string): Instant | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  if (at !== undefined) return moveToDay(at, timeZone, day);

  const midnightAsUtc = Date.parse(`${day}T00:00:00Z`);
  return midnightAsUtc - offsetAt(midnightAsUtc, timeZone);
}
