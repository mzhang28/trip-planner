import type { Instant, TripEvent } from '@trip/crdt';
import { dayKey } from './time';

/** A calendar day as `YYYY-MM-DD`. */
export type DayKey = string;

export function addDays(day: DayKey, count: number): DayKey {
  const at = Date.parse(`${day}T12:00:00Z`) + count * 24 * 60 * 60 * 1000;
  return new Date(at).toISOString().slice(0, 10);
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

    const from = dayKey(checkIn, zone);
    const to =
      event.lodging?.checkOut === undefined
        ? from
        : addDays(dayKey(event.lodging.checkOut, zone), -1);

    spans.push({ event, from, to: to < from ? from : to });
  }

  return spans.sort((a, b) => a.from.localeCompare(b.from));
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
