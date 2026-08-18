import type { Instant, TripEvent } from '@trip/crdt';
import type { DayKey } from './calendar';
import { setDay } from './time';

/**
 * Which zone each day of a trip is lived in.
 *
 * A trip that crosses zones has days that are not all on the same clock, and a
 * calendar drawn on one clock throughout says the wrong thing twice over: an
 * event lands in the wrong column, and the hours down the side belong to a
 * place nobody is. So a day is treated as a slot with a zone of its own —
 * worked out from the journeys already recorded, and correctable by hand.
 *
 * The slots are assigned automatically. Nothing here asks anyone to lay out
 * their trip in advance: the flights say where you are, and a day nobody has
 * flown on is wherever the day before ended.
 */

/** A moment the trip's zone changes, and what it changes to. */
export interface ZoneChange {
  at: Instant;
  zone: string;
}

/**
 * The journeys that move the trip from one zone to another.
 *
 * Read from transit events, which record the zone at each end of a journey:
 * `departsTz` is where it starts and `arrivesTz` where it lands. A flight with
 * neither says nothing about where the trip is, and is passed over rather than
 * guessed at.
 */
export function zoneChanges(events: TripEvent[]): ZoneChange[] {
  const changes: ZoneChange[] = [];

  for (const event of events) {
    if (event.deletedAt !== undefined || event.startsAt === undefined) continue;

    const arrivesTz = event.transit?.arrivesTz;
    if (arrivesTz === undefined) continue;

    // Landing, not taking off. Until the wheels are down the trip is still in
    // the zone it left, which is the clock the departure is written in.
    const arrival = event.startsAt + (event.durationMinutes ?? 0) * 60_000;
    changes.push({ at: arrival, zone: arrivesTz });
  }

  return changes.sort((a, b) => a.at - b.at);
}

/**
 * The zone the trip is in before any journey it records.
 *
 * The first flight's `departsTz` is the best evidence for it -- a trip that
 * starts at home and flies out is in the home zone until it does. Falls back to
 * the trip's own home zone, which is what a trip with no flights uses
 * throughout.
 */
function startingZone(events: TripEvent[], homeTimezone: string): string {
  const departures = events
    .filter(
      (event): event is TripEvent & { startsAt: number } =>
        event.deletedAt === undefined &&
        event.startsAt !== undefined &&
        event.transit?.departsTz !== undefined,
    )
    .sort((a, b) => a.startsAt - b.startsAt);

  return departures[0]?.transit?.departsTz ?? homeTimezone;
}

export interface DaySlot {
  day: DayKey;
  zone: string;
  /** When the slot begins: midnight of `day` in `zone`. */
  startsAt: Instant;
  /** The zone was fixed by hand on this day. Later days inherit it silently. */
  overridden: boolean;
  /** The zone differs from the day before, so this is where the trip moved. */
  changedFromPrevious: boolean;
}

/**
 * Turns the trip's days into slots, each with the zone it is lived in.
 *
 * A day is lived on the clock it began on, so the day you fly is still the
 * departure's day and the new zone starts the morning after. A travel day is
 * then longer or shorter than 24 hours -- flying east across the date line
 * makes one that runs most of two calendar days -- and everything that happens
 * before the next morning belongs to it, which is how the day felt.
 *
 * The alternative was to switch on landing. It reads well for an afternoon
 * arrival and badly for everything else: a red-eye landing at 06:00 would put
 * the whole previous evening on a clock nobody was on yet.
 */
export function daySlots(
  days: DayKey[],
  events: TripEvent[],
  homeTimezone: string,
  overrides: Record<string, string> | undefined,
): DaySlot[] {
  const changes = zoneChanges(events);
  const slots: DaySlot[] = [];

  let zone = startingZone(events, homeTimezone);
  let next = 0;

  for (const day of days) {
    /*
     * A correction carries forward, the way an arrival does. Somebody fixing a
     * day is saying where the trip is from then on -- "we are in Honolulu from
     * the fifth" is one thing to say, not one per day until the flight home.
     * The next recorded arrival takes over from it.
     */
    const override = overrides?.[day];
    if (override !== undefined) zone = override;

    const settled = zone;
    const opened = setDay(undefined, settled, day) ?? Date.parse(`${day}T00:00:00Z`);

    slots.push({
      day,
      zone: settled,
      startsAt: opened,
      overridden: override !== undefined,
      changedFromPrevious: slots.length > 0 && slots[slots.length - 1]!.zone !== settled,
    });

    /*
     * Journeys landing before this day is out set the zone for the next one.
     * The day's own end is measured on the clock the day is lived on, which is
     * the one just settled -- a travel day's real length comes out of the
     * boundary between this slot and the next, not out of this arithmetic.
     */
    const closes = opened + 24 * 60 * 60 * 1000;
    while (next < changes.length && changes[next]!.at < closes) {
      zone = changes[next]!.zone;
      next += 1;
    }
  }

  return slots;
}

/**
 * Consecutive days sharing a zone.
 *
 * The week draws one column of hours per run rather than per day: the hours
 * only change where the trip does, and repeating them above every day would be
 * seven copies of the same rail.
 */
export interface ZoneRun {
  zone: string;
  days: DaySlot[];
}

export function zoneRuns(slots: DaySlot[]): ZoneRun[] {
  const runs: ZoneRun[] = [];

  for (const slot of slots) {
    const current = runs[runs.length - 1];
    if (current && current.zone === slot.zone) current.days.push(slot);
    else runs.push({ zone: slot.zone, days: [slot] });
  }

  return runs;
}

/**
 * Which slot an instant belongs to.
 *
 * A slot runs from its own midnight to the next slot's, which is what makes a
 * day that gains or loses hours hold the right events: fly west and the day is
 * longer than 24 hours, and everything in it is still that day. The last slot
 * has no successor, so it runs a nominal day.
 *
 * Returns null for an instant outside the trip, which the calendar draws
 * nowhere.
 */
export function slotForInstant(slots: DaySlot[], at: Instant): DayKey | null {
  if (slots.length === 0) return null;

  const first = slots[0]!;
  if (at < first.startsAt) return null;

  for (let index = 0; index < slots.length; index += 1) {
    const ends = slots[index + 1]?.startsAt ?? slots[index]!.startsAt + 24 * 60 * 60 * 1000;
    if (at < ends) return slots[index]!.day;
  }

  return null;
}

/** The events of each slot, in the order they happen. */
export function eventsBySlot(events: TripEvent[], slots: DaySlot[]): Map<DayKey, TripEvent[]> {
  const byDay = new Map<DayKey, TripEvent[]>();

  for (const event of events) {
    if (event.startsAt === undefined) continue;

    const day = slotForInstant(slots, event.startsAt);
    if (day === null) continue;

    const bucket = byDay.get(day);
    if (bucket) bucket.push(event);
    else byDay.set(day, [event]);
  }

  for (const bucket of byDay.values()) {
    bucket.sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0));
  }

  return byDay;
}

/** The zone of a given day, for the parts of the app that ask day by day. */
export function zoneOfDay(slots: DaySlot[], day: DayKey, fallback: string): string {
  return slots.find((slot) => slot.day === day)?.zone ?? fallback;
}
