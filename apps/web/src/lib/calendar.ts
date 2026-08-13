import type { Instant, TripEvent, TripMeta } from '@trip/crdt';
import { dayKey } from './time';

/** A calendar day as `YYYY-MM-DD`. */
export type DayKey = string;

export function addDays(day: DayKey, count: number): DayKey {
  const at = Date.parse(`${day}T12:00:00Z`) + count * 24 * 60 * 60 * 1000;
  return new Date(at).toISOString().slice(0, 10);
}

export function clampDay(day: DayKey, start: DayKey, end: DayKey): DayKey {
  return day < start ? start : day > end ? end : day;
}

export interface TripDateRange {
  start: DayKey;
  /** Inclusive: a trip ending Friday includes Friday. */
  end: DayKey;
}

/**
 * The finite run of days that belongs to a trip.
 *
 * New trips store these bounds explicitly. Older documents fall back to their
 * scheduled events, or one week from today when they have no dated events, so
 * upgrading never produces an empty calendar or an unbounded scroller.
 */
export function tripDateRange(
  meta: Pick<TripMeta, 'startsAt' | 'endsAt'> | undefined,
  events: TripEvent[],
  homeTimezone: string,
  today: DayKey,
): TripDateRange {
  const eventDays = events
    .map((event) => eventDay(event, homeTimezone))
    .filter((day): day is DayKey => day !== null)
    .sort();
  const explicitStart =
    meta?.startsAt === undefined ? undefined : dayKey(meta.startsAt, homeTimezone);
  const explicitEnd = meta?.endsAt === undefined ? undefined : dayKey(meta.endsAt, homeTimezone);

  let start = explicitStart ?? eventDays[0];
  let end = explicitEnd ?? eventDays[eventDays.length - 1];

  if (!start && end) start = addDays(end, -6);
  if (!start) start = today;
  if (!end) end = addDays(start, 6);

  // Concurrent edits can briefly cross the bounds. The calendar remains
  // usable while the settings screen makes the next edit restore the order.
  return start <= end ? { start, end } : { start: end, end: start };
}

export function daysInRange(start: DayKey, end: DayKey): DayKey[] {
  const days: DayKey[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

/** 0 for Monday. Weeks start on Monday, which is how a trip is talked about. */
export function weekdayOf(day: DayKey): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

export function startOfWeek(day: DayKey): DayKey {
  return addDays(day, -weekdayOf(day));
}

export function weekOf(day: DayKey): DayKey[] {
  const start = startOfWeek(day);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/**
 * The grid a month is drawn on: whole weeks, so every row has seven cells.
 *
 * The days either side of the month are real days and are included, because a
 * trip that starts on the 30th needs the row it starts in to be complete.
 */
export function monthGrid(day: DayKey): DayKey[] {
  const first = `${day.slice(0, 7)}-01`;
  const start = startOfWeek(first);

  const lastDay = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0, 12),
  )
    .toISOString()
    .slice(0, 10);

  const cells: DayKey[] = [];
  for (let cursor = start; cursor <= lastDay || cells.length % 7 !== 0; cursor = addDays(cursor, 1)) {
    cells.push(cursor);
    if (cells.length > 42) break;
  }

  return cells;
}

/**
 * Four complete weeks around a focal day.
 *
 * A four-row board cannot put every weekday at the exact midpoint. The week
 * containing the focal day goes in whichever of the two middle rows keeps the
 * day closest to the centre of the 28-day range.
 */
export function fourWeekGrid(day: DayKey): DayKey[] {
  const weeksBefore = weekdayOf(day) <= 3 ? 2 : 1;
  const start = addDays(startOfWeek(day), -weeksBefore * 7);
  return Array.from({ length: 28 }, (_, index) => addDays(start, index));
}

export function monthOf(day: DayKey): string {
  return day.slice(0, 7);
}

/** Which day an event falls on, in the zone of the place it happens. */
export function eventDay(event: TripEvent, homeTimezone: string): DayKey | null {
  if (event.startsAt === undefined) return null;
  return dayKey(event.startsAt, event.timezone ?? homeTimezone);
}

export function eventsByDay(
  events: TripEvent[],
  homeTimezone: string,
): Map<DayKey, TripEvent[]> {
  const days = new Map<DayKey, TripEvent[]>();

  for (const event of events) {
    const key = eventDay(event, homeTimezone);
    if (!key) continue;

    const bucket = days.get(key);
    if (bucket) bucket.push(event);
    else days.set(key, [event]);
  }

  for (const bucket of days.values()) {
    bucket.sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0));
  }

  return days;
}

export interface Segment {
  label: string;
  from: DayKey;
  /** Inclusive. */
  to: DayKey;
}

/**
 * Runs of consecutive days spent in one city.
 *
 * This is what the month view draws as a continuous band instead of a dot per
 * day. A month of a trip reads as three or four places rather than thirty
 * separate squares, which is the thing a calendar of a trip is actually for.
 *
 * A day with no city carries on the previous one: nobody leaves a city by
 * failing to label a day.
 */
export function citySegments(
  byDay: Map<DayKey, TripEvent[]>,
  days: DayKey[],
): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  let carried: string | null = null;

  for (const day of days) {
    const named = byDay.get(day)?.find((event) => event.city)?.city ?? null;
    const city = named ?? carried;

    // Only a named day extends the carry. A gap before any city is named stays
    // blank rather than borrowing from a later one.
    if (named) carried = named;

    if (city && current && current.label === city && addDays(current.to, 1) === day) {
      current.to = day;
      continue;
    }

    if (current) segments.push(current);
    current = city ? { label: city, from: day, to: day } : null;
  }

  if (current) segments.push(current);
  return segments;
}

export interface CityDaySegment {
  label: string;
  /** Minute of the day at which this city starts, from 0 through 1439. */
  fromMinute: number;
  /** Exclusive end, up to 1440. */
  toMinute: number;
}

interface CityTransition {
  day: DayKey;
  minute: number;
  label: string;
  startsAt: number;
  /** A journey's origin also tells us where the otherwise-unknown lead-in was. */
  carriesBackward?: boolean;
}

/** An instant's wall-clock minute in the place where that boundary happens. */
function instantMinute(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(at);
  const part = (type: 'hour' | 'minute') =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? 0);

  return part('hour') * 60 + part('minute');
}

function cityTransition(
  at: number,
  timeZone: string,
  label: string | undefined,
  options: { timeUndecided?: boolean; carriesBackward?: boolean } = {},
): CityTransition | null {
  if (!label) return null;

  return {
    day: dayKey(at, timeZone),
    minute: options.timeUndecided ? 0 : instantMinute(at, timeZone),
    label,
    startsAt: at,
    carriesBackward: options.carriesBackward,
  };
}

/**
 * Every known change of city, including both ends of a journey.
 *
 * Ordinary events establish their own city at their start. A flight or transit
 * event establishes its origin at departure and its destination at arrival.
 */
function cityTransitions(events: TripEvent[], homeTimezone: string): CityTransition[] {
  const transitions: CityTransition[] = [];

  for (const event of events) {
    if (event.startsAt === undefined) continue;

    const isJourney = event.kind === 'transit';
    const departureZone = isJourney
      ? event.transit?.departsTz ?? event.timezone ?? homeTimezone
      : event.timezone ?? homeTimezone;
    const fromCity = isJourney ? event.transit?.fromCity ?? event.city : event.city;
    const toCity = isJourney ? event.transit?.toCity : undefined;

    const departure = cityTransition(event.startsAt, departureZone, fromCity, {
      timeUndecided: event.timeUndecided,
      carriesBackward: isJourney,
    });
    if (departure) transitions.push(departure);

    // Without a known start time and length, choosing an arrival boundary
    // would invent how much of the day belongs to either endpoint.
    if (
      !isJourney ||
      !toCity ||
      event.timeUndecided ||
      event.durationMinutes === undefined ||
      event.durationMinutes <= 0
    ) {
      continue;
    }

    const arrivesAt = event.startsAt + event.durationMinutes * 60_000;
    const arrivalZone = isJourney ? event.transit?.arrivesTz ?? departureZone : departureZone;
    const arrival = cityTransition(arrivesAt, arrivalZone, toCity);
    if (arrival) transitions.push(arrival);
  }

  return transitions.sort(
    (a, b) => a.day.localeCompare(b.day) || a.minute - b.minute || a.startsAt - b.startsAt,
  );
}

/**
 * The cities occupying each day, split at the exact time a new city begins.
 *
 * A named city carries through later events and the gaps between them. Journey
 * origins also carry backward until the preceding known boundary, while their
 * destinations take over at arrival. On the first named day, the first city
 * covers midnight up to any later transition.
 */
export function cityDaySegments(
  events: TripEvent[],
  days: DayKey[],
  homeTimezone: string,
): Map<DayKey, CityDaySegment[]> {
  const result = new Map<DayKey, CityDaySegment[]>();
  if (days.length === 0) return result;

  const transitions = cityTransitions(events, homeTimezone);

  let carried: string | null = null;
  let transitionIndex = 0;

  if (
    transitions[0]?.carriesBackward &&
    transitions[0].day >= days[0]!
  ) {
    carried = transitions[0].label;
  }

  while (
    transitionIndex < transitions.length &&
    transitions[transitionIndex]!.day < days[0]!
  ) {
    carried = transitions[transitionIndex]!.label;
    transitionIndex += 1;
  }

  for (const day of days) {
    while (transitionIndex < transitions.length && transitions[transitionIndex]!.day < day) {
      carried = transitions[transitionIndex]!.label;
      transitionIndex += 1;
    }

    const today: CityTransition[] = [];
    while (transitionIndex < transitions.length && transitions[transitionIndex]!.day === day) {
      today.push(transitions[transitionIndex]!);
      transitionIndex += 1;
    }

    let current = carried ?? today[0]?.label ?? null;
    let fromMinute = 0;
    const segments: CityDaySegment[] = [];

    for (const transition of today) {
      if (transition.label === current) continue;
      if (current && transition.minute > fromMinute) {
        segments.push({ label: current, fromMinute, toMinute: transition.minute });
      }
      current = transition.label;
      fromMinute = transition.minute;
    }

    if (current) {
      segments.push({ label: current, fromMinute, toMinute: 24 * 60 });
      carried = current;
    }
    result.set(day, segments);
  }

  return result;
}

export interface LodgingSpan {
  event: TripEvent;
  from: DayKey;
  /** The last night, not the checkout day: you do not sleep there on checkout. */
  to: DayKey;
}

/**
 * Hotels as the nights they cover.
 *
 * Drawn along the bottom of the week as one continuous bar each, so where you
 * are sleeping reads without looking at a single event.
 */
export function lodgingSpans(events: TripEvent[], homeTimezone: string): LodgingSpan[] {
  const spans: LodgingSpan[] = [];

  for (const event of events) {
    if (event.kind !== 'lodging') continue;

    const zone = event.timezone ?? homeTimezone;
    const checkIn = event.lodging?.checkIn ?? event.startsAt;
    if (checkIn === undefined) continue;

    const checkOut =
      event.lodging?.checkOut ??
      (event.startsAt === undefined || event.durationMinutes === undefined
        ? undefined
        : event.startsAt + event.durationMinutes * 60_000);

    const from = dayKey(checkIn, zone);
    const to = checkOut === undefined ? from : addDays(dayKey(checkOut, zone), -1);

    spans.push({ event, from, to: to < from ? from : to });
  }

  return spans.sort((a, b) => a.from.localeCompare(b.from));
}

/**
 * The runs of nights no hotel covers, in the same terms as a span.
 *
 * Consecutive nights come back as one run rather than one each, so a week with
 * nowhere to sleep reads as a single gap to fill instead of seven identical
 * offers. The last night of a run is the last night without a bed, so a stay
 * that fills it checks out the following morning.
 */
export function nightsWithoutLodging(
  spans: LodgingSpan[],
  days: DayKey[],
): Array<{ from: DayKey; to: DayKey; start: number; length: number }> {
  const runs: Array<{ from: DayKey; to: DayKey; start: number; length: number }> = [];
  let openedAt: number | null = null;

  // One past the end, so a run reaching the last day is closed by the same code
  // that closes every other one.
  for (let index = 0; index <= days.length; index++) {
    const day = days[index];
    const empty =
      day !== undefined && !spans.some((span) => day >= span.from && day <= span.to);

    if (empty && openedAt === null) openedAt = index;

    if (!empty && openedAt !== null) {
      runs.push({
        from: days[openedAt]!,
        to: days[index - 1]!,
        start: openedAt,
        length: index - openedAt,
      });
      openedAt = null;
    }
  }

  return runs;
}

/** Where a span sits within a run of days, for drawing it across columns. */
export function spanWithin(
  span: { from: DayKey; to: DayKey },
  days: DayKey[],
): { start: number; length: number } | null {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last || span.to < first || span.from > last) return null;

  const start = Math.max(
    0,
    days.findIndex((day) => day === span.from),
  );
  const endIndex = days.findIndex((day) => day === span.to);
  const end = endIndex === -1 ? days.length - 1 : endIndex;

  return { start, length: end - start + 1 };
}

/**
 * The day a trip should open on.
 *
 * Today, when the trip is happening around now. Otherwise its next day, and
 * failing that its last — a trip in April opened in January should show April,
 * not an empty January that says nothing about it.
 */
export function openingDay(events: TripEvent[], homeTimezone: string, today: DayKey): DayKey {
  const days = events
    .map((event) => eventDay(event, homeTimezone))
    .filter((day): day is DayKey => day !== null)
    .sort();

  if (days.length === 0) return today;
  if (days.some((day) => day === today)) return today;

  return days.find((day) => day > today) ?? days[days.length - 1]!;
}
