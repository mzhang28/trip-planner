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

/**
 * Formatters, kept rather than rebuilt.
 *
 * `new Intl.DateTimeFormat` is one of the most expensive calls in the browser:
 * it resolves a locale and loads the zone's rules. Every helper below used to
 * build one per call, on paths that run per event per render -- laying out a
 * week of a busy trip built thousands, and opening the view took seconds.
 *
 * A formatter is immutable and depends only on its locale and options, so one
 * per combination is all anybody needs. The cache is unbounded on purpose:
 * there are around 400 zones and a handful of shapes, so it settles at a few
 * hundred entries and never grows again.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(
  locale: string | string[] | undefined,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${Array.isArray(locale) ? locale.join(',') : (locale ?? '')}|${JSON.stringify(options)}`;

  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }

  return found;
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

  const parts = formatter('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(at);

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? timeZone;
}

/** All familiar short names accepted when searching for a zone. */
export function timeZoneSearchAbbreviations(at: Instant, timeZone: string): string[] {
  return [
    timeZoneAbbreviation(at, timeZone),
    ...(FRIENDLY_ZONE_NAMES[timeZone]?.map(([, name]) => name) ?? []),
  ];
}

const twelveHourClocks = new Map<string, boolean>();

/**
 * Whether clocks read as twelve hours here, with AM and PM.
 *
 * The browser answers this from the visitor's locale and, where the system
 * exposes it, from their clock setting: somebody on en-US who has switched
 * their device to a 24-hour clock resolves to h23. Asking it rather than
 * keeping a setting of our own means times read the way the rest of their
 * device reads.
 */
export function usesTwelveHourClock(locale?: string | string[]): boolean {
  const key = Array.isArray(locale) ? locale.join(',') : (locale ?? '');

  let found = twelveHourClocks.get(key);
  if (found === undefined) {
    const cycle = formatter(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    found = cycle === 'h11' || cycle === 'h12';
    twelveHourClocks.set(key, found);
  }

  return found;
}

/**
 * A time of day as the person reading it writes times.
 *
 * The hour cycle is named rather than left to the locale so that the two ends
 * of the day are not surprising: h23 puts midnight at 00:00 instead of 24:00,
 * and h12 puts noon at 12 PM instead of 0 PM.
 */
export function formatTime(at: Instant, timeZone: string, locale?: string | string[]): string {
  const twelveHour = usesTwelveHourClock(locale);

  return formatter(locale, {
    // A padded hour keeps a column of times aligned. There is nothing to align
    // against once AM or PM is on the end, and "09:00 AM" is not how anybody
    // writes it.
    hour: twelveHour ? 'numeric' : '2-digit',
    minute: '2-digit',
    hourCycle: twelveHour ? 'h12' : 'h23',
    timeZone,
  }).format(at);
}

/**
 * A whole hour as a timetable's axis labels it.
 *
 * The minutes are left off a twelve-hour label: every one of them is :00, and
 * dropping them keeps the axis inside the width the 24-hour labels already fit
 * in. A 24-hour label keeps them, which is the form those clocks are written
 * in.
 */
export function formatHourLabel(hour: number, locale?: string | string[]): string {
  const at = Date.UTC(2026, 0, 1, hour % 24);

  return usesTwelveHourClock(locale)
    ? formatter(locale, { hour: 'numeric', hourCycle: 'h12', timeZone: 'UTC' }).format(at)
    : formatTime(at, 'UTC', locale);
}

/**
 * An example of a time, for a placeholder or for saying what went wrong.
 *
 * Telling somebody on a twelve-hour clock to write 17:30 asks them to convert
 * something their device never shows them.
 */
export function clockExample(
  hour: number,
  minute: number,
  locale?: string | string[],
): string {
  return formatTime(Date.UTC(2026, 0, 1, hour, minute), 'UTC', locale);
}

/**
 * The time of day of an instant, as `HH:MM`.
 *
 * The form times are carried in rather than shown in: it sorts, it parses, and
 * it does not change with whoever is looking. Anything a person reads should
 * come from `formatTime` instead.
 */
export function toTimeInput(at: Instant, timeZone: string): string {
  return formatter('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(at);
}

/**
 * How far into its local day an instant falls, in minutes.
 *
 * What a timetable column is drawn from: the same instant is a different
 * position in the day depending on the clock the column is on.
 */
export function minutesSinceMidnight(at: Instant, timeZone: string): number {
  const parts = formatter('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).formatToParts(at);

  const value = (part: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === part)?.value ?? '0');

  // Midnight reads as 24 in some locales' two-digit hour.
  return (value('hour') % 24) * 60 + value('minute');
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
  return formatter(locale, {
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
  return formatter('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(at);
}

/**
 * Reads a typed clock, on either a twelve- or a 24-hour one.
 *
 * Both are read wherever a time is typed, whichever the browser shows, so a
 * time copied from somewhere else is understood without being converted first.
 * The AM or PM may be spaced, dotted, or in either case, because all of those
 * get typed; `Intl` itself separates them with a narrow no-break space.
 *
 * Minutes are required on a bare number, so that tabbing out of a half-typed
 * "9" is an error rather than a silent 09:00. "9 PM" leaves nothing half-typed
 * and is allowed.
 */
function parseClock(text: string): { hours: number; minutes: number } | null {
  const trimmed = text.trim();

  const halfDay = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?$/i.exec(trimmed);
  if (halfDay) {
    const hours = Number(halfDay[1]);
    const minutes = halfDay[2] === undefined ? 0 : Number(halfDay[2]);
    if (hours < 1 || hours > 12 || minutes > 59) return null;

    const afternoon = halfDay[3]?.toLowerCase() === 'p';
    return { hours: (hours % 12) + (afternoon ? 12 : 0), minutes };
  }

  const wholeDay = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!wholeDay) return null;

  const hours = Number(wholeDay[1]);
  const minutes = Number(wholeDay[2]);
  if (hours > 23 || minutes > 59) return null;

  return { hours, minutes };
}

/**
 * Reads a clock in the given zone and returns the instant on the same day.
 *
 * Works by measuring how far the zone is from UTC at that moment and shifting
 * by it. That has to be measured at the target instant rather than assumed,
 * because the offset changes across a daylight-saving boundary.
 */
export function setTimeOfDay(at: Instant, timeZone: string, clock: string): Instant | null {
  const parsed = parseClock(clock);
  if (!parsed) return null;

  const day = dayKey(at, timeZone);
  const hhmm = `${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`;
  const asUtc = Date.parse(`${day}T${hhmm}:00Z`);

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
  clock: string,
): Instant | null {
  const sameDay = setTimeOfDay(startsAt, timeZone, clock);
  if (sameDay === null || sameDay > startsAt) return sameDay;

  const day = new Date(`${dayKey(startsAt, timeZone)}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  const nextDay = moveToDay(startsAt, timeZone, day.toISOString().slice(0, 10));
  return nextDay === null ? null : setTimeOfDay(nextDay, timeZone, clock);
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

  const asUtc = Date.parse(`${targetDay}T${toTimeInput(at, timeZone)}:00Z`);
  if (Number.isNaN(asUtc)) return null;

  return asUtc - offsetAt(asUtc, timeZone);
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
function offsetAt(at: Instant, timeZone: string): number {
  const parts = formatter('en-US', {
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
