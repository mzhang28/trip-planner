import type { TripEvent } from '@trip/crdt';
import { describe, expect, it } from 'vitest';
import { daysInRange } from './calendar';
import { daySlots, eventsBySlot, slotForInstant, zoneRuns } from './dayZones';
import { setDay, setTimeOfDay } from './time';

function at(day: string, hhmm: string, zone: string): number {
  const midnight = setDay(undefined, zone, day)!;
  return setTimeOfDay(midnight, zone, hhmm)!;
}

function event(partial: Partial<TripEvent> & { id: string }): TripEvent {
  return {
    kind: 'activity',
    name: partial.id,
    booking: { status: 'idea' },
    links: {},
    attachments: {},
    customFields: {},
    updatedAt: 0,
    updatedBy: 'u1',
    ...partial,
  } as TripEvent;
}

/** Tokyo to Honolulu: eight hours in the air, and a day that gains hours. */
function flight(): TripEvent {
  return event({
    id: 'flight',
    kind: 'transit',
    startsAt: at('2026-09-05', '09:00', 'Asia/Tokyo'),
    durationMinutes: 8 * 60,
    transit: { method: 'flight', departsTz: 'Asia/Tokyo', arrivesTz: 'Pacific/Honolulu' },
  });
}

describe('what zone a day is lived in', () => {
  const days = daysInRange('2026-09-03', '2026-09-08');

  it('keeps the whole trip on one clock when nothing flies', () => {
    const slots = daySlots(days, [], 'Asia/Tokyo', undefined);
    expect(slots.every((slot) => slot.zone === 'Asia/Tokyo')).toBe(true);
    expect(zoneRuns(slots)).toHaveLength(1);
  });

  it('moves to the zone a flight lands in, from the morning after', () => {
    const slots = daySlots(days, [flight()], 'Asia/Tokyo', undefined);
    const zoneOf = (day: string) => slots.find((slot) => slot.day === day)!.zone;

    expect(zoneOf('2026-09-04')).toBe('Asia/Tokyo');
    // The day of the flight is still the day it departed on: a travel day is
    // lived on the clock it began on, however long that makes it.
    expect(zoneOf('2026-09-05')).toBe('Asia/Tokyo');
    expect(zoneOf('2026-09-06')).toBe('Pacific/Honolulu');
  });

  it('takes the zone before the first flight from where it departs', () => {
    // The trip's home zone is somewhere else entirely; the flight out of Tokyo
    // is better evidence of where the first days are spent.
    const slots = daySlots(days, [flight()], 'Europe/London', undefined);
    expect(slots[0]!.zone).toBe('Asia/Tokyo');
  });

  it('lets a day be corrected by hand, and says which days were', () => {
    const slots = daySlots(days, [flight()], 'Asia/Tokyo', {
      '2026-09-04': 'Pacific/Honolulu',
    });

    const corrected = slots.find((slot) => slot.day === '2026-09-04')!;
    expect(corrected.zone).toBe('Pacific/Honolulu');
    expect(corrected.overridden).toBe(true);
    expect(slots.find((slot) => slot.day === '2026-09-03')!.overridden).toBe(false);
  });

  it('groups the days into runs, one per clock', () => {
    const runs = zoneRuns(daySlots(days, [flight()], 'Asia/Tokyo', undefined));

    expect(runs.map((run) => run.zone)).toEqual(['Asia/Tokyo', 'Pacific/Honolulu']);
    expect(runs.map((run) => run.days.length)).toEqual([3, 3]);
    expect(runs[1]!.days[0]!.changedFromPrevious).toBe(true);
  });
});

describe('which day an event falls on', () => {
  const days = daysInRange('2026-09-03', '2026-09-08');

  it('puts an event in the slot whose hours contain it', () => {
    const slots = daySlots(days, [flight()], 'Asia/Tokyo', undefined);

    const breakfast = event({
      id: 'breakfast',
      startsAt: at('2026-09-04', '08:00', 'Asia/Tokyo'),
    });
    const beach = event({
      id: 'beach',
      startsAt: at('2026-09-05', '16:00', 'Pacific/Honolulu'),
    });

    expect(slotForInstant(slots, breakfast.startsAt!)).toBe('2026-09-04');
    expect(slotForInstant(slots, beach.startsAt!)).toBe('2026-09-05');
  });

  it('holds a day that gains hours together', () => {
    const slots = daySlots(days, [flight()], 'Asia/Tokyo', undefined);
    const landing = flight();

    /*
     * The flight leaves Tokyo at 09:00 on the 5th and lands in Honolulu at
     * 12:00 on the 4th, local -- the date line runs between them. The travel
     * day is the Tokyo day it began on, and it runs until Honolulu's next
     * morning, so both ends of the journey are inside it.
     */
    const day = slotForInstant(slots, landing.startsAt!);
    expect(day).toBe('2026-09-05');

    const byDay = eventsBySlot([landing], slots);
    expect(byDay.get(day!)!.map((e) => e.id)).toEqual(['flight']);

    // Dinner in Honolulu that evening, which is still the 4th there, belongs
    // to the travel day rather than to a day that has not started yet.
    const dinner = at('2026-09-04', '19:00', 'Pacific/Honolulu');
    expect(slotForInstant(slots, dinner)).toBe('2026-09-05');
  });

  it('leaves an instant outside the trip on no day at all', () => {
    const slots = daySlots(days, [], 'Asia/Tokyo', undefined);
    expect(slotForInstant(slots, at('2026-08-01', '10:00', 'Asia/Tokyo'))).toBeNull();
    expect(slotForInstant(slots, at('2026-10-01', '10:00', 'Asia/Tokyo'))).toBeNull();
  });

  it('sorts each slot by when things happen', () => {
    const slots = daySlots(days, [], 'Asia/Tokyo', undefined);
    const later = event({ id: 'later', startsAt: at('2026-09-04', '18:00', 'Asia/Tokyo') });
    const earlier = event({ id: 'earlier', startsAt: at('2026-09-04', '09:00', 'Asia/Tokyo') });

    const byDay = eventsBySlot([later, earlier], slots);
    expect(byDay.get('2026-09-04')!.map((e) => e.id)).toEqual(['earlier', 'later']);
  });
});
