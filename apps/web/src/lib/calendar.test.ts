import type { TripEvent } from '@trip/crdt';
import { describe, expect, it } from 'vitest';
import type { DayKey } from './calendar';
import {
  addDays,
  clampDay,
  cityDaySegments,
  citySegments,
  daysInRange,
  eventsByDay,
  fourWeekGrid,
  lodgingSpans,
  monthGrid,
  nightsWithoutLodging,
  openingDay,
  spanWithin,
  startOfWeek,
  tripDateRange,
  weekOf,
  weekdayOf,
} from './calendar';

const TOKYO = 'Asia/Tokyo';

function event(overrides: Partial<TripEvent>): TripEvent {
  return {
    id: Math.random().toString(36).slice(2),
    kind: 'activity',
    name: 'Something',
    booking: { status: 'idea' },
    links: {},
    attachments: {},
    customFields: {},
    updatedAt: 0,
    updatedBy: 'u1',
    timezone: TOKYO,
    ...overrides,
  };
}

/** Midday on the given day in Tokyo, so the day is unambiguous. */
function at(day: string, hour = 12): number {
  return Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00+09:00`);
}

describe('day arithmetic', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('starts weeks on Monday', () => {
    // 14 August 2026 is a Friday.
    expect(weekdayOf('2026-08-14')).toBe(4);
    expect(startOfWeek('2026-08-14')).toBe('2026-08-10');
    expect(startOfWeek('2026-08-10')).toBe('2026-08-10');
    // Sunday belongs to the week that began the previous Monday.
    expect(startOfWeek('2026-08-16')).toBe('2026-08-10');
  });

  it('gives seven days for a week', () => {
    expect(weekOf('2026-08-14')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
  });

  it('draws a month as whole weeks', () => {
    const grid = monthGrid('2026-08-14');

    expect(grid.length % 7).toBe(0);
    expect(grid[0]).toBe('2026-07-27');
    expect(grid).toContain('2026-08-01');
    expect(grid).toContain('2026-08-31');
    // A trip starting on the 30th needs its row complete, so the days either
    // side of the month are real cells rather than blanks.
    expect(grid[grid.length - 1]!).toBe('2026-09-06');
  });

  it('draws a month-ish view as exactly four weeks around its focus', () => {
    const grid = fourWeekGrid('2026-08-12');

    expect(grid).toHaveLength(28);
    expect(grid[0]).toBe('2026-07-27');
    expect(grid[27]).toBe('2026-08-23');
    expect(grid.indexOf('2026-08-12')).toBe(16);
  });

  it('builds and clamps a finite inclusive range', () => {
    expect(daysInRange('2026-08-10', '2026-08-12')).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);
    expect(clampDay('2026-08-01', '2026-08-10', '2026-08-20')).toBe('2026-08-10');
    expect(clampDay('2026-08-21', '2026-08-10', '2026-08-20')).toBe('2026-08-20');
  });
});

describe('trip date range', () => {
  it('uses explicit trip dates ahead of event dates', () => {
    expect(
      tripDateRange(
        { startsAt: at('2026-08-08'), endsAt: at('2026-08-18') },
        [event({ startsAt: at('2026-08-12') })],
        TOKYO,
        '2026-08-01',
      ),
    ).toEqual({ start: '2026-08-08', end: '2026-08-18' });
  });

  it('keeps old trips finite using their events or one week from today', () => {
    expect(
      tripDateRange(
        undefined,
        [event({ startsAt: at('2026-08-12') }), event({ startsAt: at('2026-08-16') })],
        TOKYO,
        '2026-08-01',
      ),
    ).toEqual({ start: '2026-08-12', end: '2026-08-16' });
    expect(tripDateRange(undefined, [], TOKYO, '2026-08-01')).toEqual({
      start: '2026-08-01',
      end: '2026-08-07',
    });
  });
});

describe('city segments', () => {
  const days = weekOf('2026-08-10');

  it('joins consecutive days in one city into a single run', () => {
    const byDay = eventsByDay(
      [
        event({ city: 'Kyoto', startsAt: at('2026-08-10') }),
        event({ city: 'Kyoto', startsAt: at('2026-08-11') }),
        event({ city: 'Osaka', startsAt: at('2026-08-13') }),
      ],
      TOKYO,
    );

    expect(citySegments(byDay, days)).toEqual([
      { label: 'Kyoto', from: '2026-08-10', to: '2026-08-12' },
      { label: 'Osaka', from: '2026-08-13', to: '2026-08-16' },
    ]);
  });

  it('carries a city through days with nothing planned', () => {
    // You do not leave Kyoto by failing to label Wednesday.
    const byDay = eventsByDay([event({ city: 'Kyoto', startsAt: at('2026-08-10') })], TOKYO);

    expect(citySegments(byDay, days)).toEqual([
      { label: 'Kyoto', from: '2026-08-10', to: '2026-08-16' },
    ]);
  });

  it('leaves the days before any city is named blank', () => {
    const byDay = eventsByDay([event({ city: 'Osaka', startsAt: at('2026-08-14') })], TOKYO);

    expect(citySegments(byDay, days)).toEqual([
      { label: 'Osaka', from: '2026-08-14', to: '2026-08-16' },
    ]);
  });

  it('finds nothing when no event names a city', () => {
    const byDay = eventsByDay([event({ startsAt: at('2026-08-12') })], TOKYO);
    expect(citySegments(byDay, days)).toEqual([]);
  });
});

describe('city coverage within a day', () => {
  const days = ['2026-08-11', '2026-08-12', '2026-08-13'];

  it('splits the day at the precise time a new city begins', () => {
    const segments = cityDaySegments(
      [
        event({ city: 'San Francisco', startsAt: at('2026-08-12', 0) }),
        event({ city: 'Tokyo', startsAt: at('2026-08-12', 15) }),
      ],
      days,
      TOKYO,
    );

    expect(segments.get('2026-08-12')).toEqual([
      { label: 'San Francisco', fromMinute: 0, toMinute: 15 * 60 },
      { label: 'Tokyo', fromMinute: 15 * 60, toMinute: 24 * 60 },
    ]);
  });

  it('carries the last known city into later days and into the visible range', () => {
    const segments = cityDaySegments(
      [event({ city: 'Kyoto', startsAt: at('2026-08-10', 18) })],
      days,
      TOKYO,
    );

    expect(segments.get('2026-08-11')).toEqual([
      { label: 'Kyoto', fromMinute: 0, toMinute: 24 * 60 },
    ]);
    expect(segments.get('2026-08-13')).toEqual([
      { label: 'Kyoto', fromMinute: 0, toMinute: 24 * 60 },
    ]);
  });

  it('uses midnight for a city whose time is undecided', () => {
    const segments = cityDaySegments(
      [
        event({ city: 'Kyoto', startsAt: at('2026-08-11', 12) }),
        event({ city: 'Osaka', startsAt: at('2026-08-12'), timeUndecided: true }),
      ],
      days,
      TOKYO,
    );

    expect(segments.get('2026-08-12')).toEqual([
      { label: 'Osaka', fromMinute: 0, toMinute: 24 * 60 },
    ]);
  });

  it('uses both ends of transit to cover the journey and the time around it', () => {
    const segments = cityDaySegments(
      [
        event({
          kind: 'transit',
          startsAt: at('2026-08-12', 9),
          durationMinutes: 180,
          transit: { method: 'train', fromCity: 'Kyoto', toCity: 'Osaka' },
        }),
        // This needs no duplicate city: the arrival carries through it and
        // through the otherwise-empty time after it.
        event({ startsAt: at('2026-08-13', 18) }),
      ],
      days,
      TOKYO,
    );

    expect(segments.get('2026-08-11')).toEqual([
      { label: 'Kyoto', fromMinute: 0, toMinute: 24 * 60 },
    ]);
    expect(segments.get('2026-08-12')).toEqual([
      { label: 'Kyoto', fromMinute: 0, toMinute: 12 * 60 },
      { label: 'Osaka', fromMinute: 12 * 60, toMinute: 24 * 60 },
    ]);
    expect(segments.get('2026-08-13')).toEqual([
      { label: 'Osaka', fromMinute: 0, toMinute: 24 * 60 },
    ]);
  });

  it('uses flight departure and arrival cities as separate boundaries', () => {
    const departs = at('2026-08-12', 17);
    const arrives = Date.parse('2026-08-12T21:00:00+01:00');
    const segments = cityDaySegments(
      [
        event({
          kind: 'transit',
          startsAt: departs,
          durationMinutes: (arrives - departs) / 60_000,
          transit: {
            method: 'flight',
            fromCity: 'Tokyo',
            toCity: 'London',
            departsTz: TOKYO,
            arrivesTz: 'Europe/London',
          },
        }),
      ],
      days,
      TOKYO,
    );

    expect(segments.get('2026-08-12')).toEqual([
      { label: 'Tokyo', fromMinute: 0, toMinute: 21 * 60 },
      { label: 'London', fromMinute: 21 * 60, toMinute: 24 * 60 },
    ]);
    expect(segments.get('2026-08-13')).toEqual([
      { label: 'London', fromMinute: 0, toMinute: 24 * 60 },
    ]);
  });
});

describe('lodging spans', () => {
  it('runs to the last night, not the checkout day', () => {
    const hotel = event({
      kind: 'lodging',
      name: 'Ryokan',
      lodging: { checkIn: at('2026-08-10', 15), checkOut: at('2026-08-13', 10) },
    });

    // Checked out on the 13th means the last night was the 12th.
    expect(lodgingSpans([hotel], TOKYO)).toEqual([
      { event: hotel, from: '2026-08-10', to: '2026-08-12' },
    ]);
  });

  it('covers one night when no checkout is known yet', () => {
    const hotel = event({ kind: 'lodging', lodging: { checkIn: at('2026-08-10', 15) } });
    expect(lodgingSpans([hotel], TOKYO)[0]).toMatchObject({ from: '2026-08-10', to: '2026-08-10' });
  });

  it('uses the canonical event schedule when lodging dates are not duplicated', () => {
    const hotel = event({
      kind: 'lodging',
      startsAt: at('2026-08-10', 15),
      durationMinutes: 67 * 60,
    });

    expect(lodgingSpans([hotel], TOKYO)[0]).toMatchObject({
      from: '2026-08-10',
      to: '2026-08-12',
    });
  });

  it('ignores anything that is not somewhere to sleep', () => {
    expect(lodgingSpans([event({ startsAt: at('2026-08-10') })], TOKYO)).toEqual([]);
  });
});

describe('placing a span in a run of days', () => {
  const days = weekOf('2026-08-10');

  it('gives the column it starts in and how many it covers', () => {
    expect(spanWithin({ from: '2026-08-11', to: '2026-08-13' }, days)).toEqual({
      start: 1,
      length: 3,
    });
  });

  it('clips a span that began before this week', () => {
    expect(spanWithin({ from: '2026-08-05', to: '2026-08-12' }, days)).toEqual({
      start: 0,
      length: 3,
    });
  });

  it('clips a span that runs past the end of this week', () => {
    expect(spanWithin({ from: '2026-08-15', to: '2026-08-20' }, days)).toEqual({
      start: 5,
      length: 2,
    });
  });

  it('gives nothing for a span that misses this week entirely', () => {
    expect(spanWithin({ from: '2026-09-01', to: '2026-09-03' }, days)).toBeNull();
    expect(spanWithin({ from: '2026-07-01', to: '2026-07-03' }, days)).toBeNull();
  });
});

describe('nights with nowhere to sleep', () => {
  const days = weekOf('2026-08-10');
  const span = (from: DayKey, to: DayKey) => ({ event: event({ kind: 'lodging' }), from, to });

  it('offers the whole week when there is no hotel at all', () => {
    expect(nightsWithoutLodging([], days)).toEqual([
      { from: '2026-08-10', to: '2026-08-16', start: 0, length: 7 },
    ]);
  });

  it('offers nothing when every night is covered', () => {
    expect(nightsWithoutLodging([span('2026-08-10', '2026-08-16')], days)).toEqual([]);
  });

  it('keeps consecutive empty nights together as one run', () => {
    expect(nightsWithoutLodging([span('2026-08-10', '2026-08-11')], days)).toEqual([
      { from: '2026-08-12', to: '2026-08-16', start: 2, length: 5 },
    ]);
  });

  it('splits a gap in the middle from a gap at the end', () => {
    const booked = [span('2026-08-10', '2026-08-10'), span('2026-08-13', '2026-08-14')];

    expect(nightsWithoutLodging(booked, days)).toEqual([
      { from: '2026-08-11', to: '2026-08-12', start: 1, length: 2 },
      { from: '2026-08-15', to: '2026-08-16', start: 5, length: 2 },
    ]);
  });

  it('counts a night as covered by a stay that started before this week', () => {
    expect(nightsWithoutLodging([span('2026-08-03', '2026-08-12')], days)).toEqual([
      { from: '2026-08-13', to: '2026-08-16', start: 3, length: 4 },
    ]);
  });
});

describe('which day a trip opens on', () => {
  const TODAY = '2026-08-14';

  it('opens on today when something is happening today', () => {
    const byDay = [event({ startsAt: at('2026-08-10') }), event({ startsAt: at('2026-08-14') })];
    expect(openingDay(byDay, TOKYO, TODAY)).toBe(TODAY);
  });

  it('opens on the next day of a trip that has not started', () => {
    const byDay = [event({ startsAt: at('2026-09-02') }), event({ startsAt: at('2026-09-05') })];

    // A trip in September opened in August should show September, not an empty
    // August that says nothing about it.
    expect(openingDay(byDay, TOKYO, TODAY)).toBe('2026-09-02');
  });

  it('opens on the last day of a trip that is over', () => {
    const byDay = [event({ startsAt: at('2026-07-02') }), event({ startsAt: at('2026-07-05') })];
    expect(openingDay(byDay, TOKYO, TODAY)).toBe('2026-07-05');
  });

  it('falls back to today when nothing has a date', () => {
    expect(openingDay([event({})], TOKYO, TODAY)).toBe(TODAY);
    expect(openingDay([], TOKYO, TODAY)).toBe(TODAY);
  });
});
