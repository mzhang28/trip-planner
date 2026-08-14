import type { TripEvent } from '@trip/crdt';
import { describe, expect, it } from 'vitest';
import { combineForecasts, placesByDay, type DailyWeather } from './useWeather';

const TOKYO = 'Asia/Tokyo';

/** An event with only the fields the forecast reads. */
function event(partial: Partial<TripEvent> & { id: string }): TripEvent {
  return {
    kind: 'activity',
    name: partial.id,
    booking: { status: 'idea' },
    links: {},
    custom: {},
    todos: [],
    attachments: {},
    ...partial,
  } as TripEvent;
}

function forecast(partial: Partial<DailyWeather>): DailyWeather {
  return { date: '2026-08-14', code: 0, max: 20, min: 10, ...partial };
}

describe('combineForecasts', () => {
  it('spans every city the day is spent in', () => {
    const combined = combineForecasts('2026-08-14', [
      forecast({ max: 8, min: 1, place: 'Sapporo' }),
      forecast({ max: 31, min: 26, place: 'Naha' }),
    ]);

    // The cold morning and the warm evening, both of which get packed for.
    expect(combined.max).toBe(31);
    expect(combined.min).toBe(1);
  });

  it('names every city behind the numbers', () => {
    const two = combineForecasts('2026-08-14', [
      forecast({ place: 'Kyoto' }),
      forecast({ place: 'Osaka' }),
    ]);
    expect(two.place).toBe('Kyoto and Osaka');

    const three = combineForecasts('2026-08-14', [
      forecast({ place: 'Kyoto' }),
      forecast({ place: 'Osaka' }),
      forecast({ place: 'Nara' }),
    ]);
    expect(three.place).toBe('Kyoto, Osaka and Nara');
  });

  it('says one city plainly, and says nothing when none is known', () => {
    expect(combineForecasts('2026-08-14', [forecast({ place: 'Kyoto' })]).place).toBe('Kyoto');
    expect(combineForecasts('2026-08-14', [forecast({})]).place).toBeUndefined();
  });

  it('takes the condition worth knowing about', () => {
    // Clear in the city being left, raining in the one being arrived at.
    const combined = combineForecasts('2026-08-14', [
      forecast({ code: 0, place: 'Kyoto' }),
      forecast({ code: 63, place: 'Tokyo' }),
    ]);

    expect(combined.code).toBe(63);
  });
});

describe('placesByDay', () => {
  const kyoto = { label: 'Fushimi Inari', lat: 34.97, lng: 135.77 };
  const osaka = { label: 'Dotonbori', lat: 34.67, lng: 135.5 };

  it('collects every city of a day, in the order the day meets them', () => {
    const { daySpots } = placesByDay(
      [
        event({
          id: 'a',
          city: 'Kyoto',
          location: kyoto,
          startsAt: Date.UTC(2026, 7, 14, 0),
          timezone: TOKYO,
        }),
        event({
          id: 'b',
          city: 'Osaka',
          location: osaka,
          startsAt: Date.UTC(2026, 7, 14, 9),
          timezone: TOKYO,
        }),
      ],
      TOKYO,
    );

    expect(daySpots.get('2026-08-14')?.map((spot) => spot.label)).toEqual(['Kyoto', 'Osaka']);
  });

  it('asks about a city once, however many places are pinned in it', () => {
    const { daySpots, spots } = placesByDay(
      [
        event({
          id: 'a',
          city: 'Kyoto',
          location: kyoto,
          startsAt: Date.UTC(2026, 7, 14, 0),
          timezone: TOKYO,
        }),
        event({
          id: 'b',
          city: 'Kyoto',
          location: { label: 'Kinkaku-ji', lat: 35.04, lng: 135.73 },
          startsAt: Date.UTC(2026, 7, 14, 3),
          timezone: TOKYO,
        }),
      ],
      TOKYO,
    );

    expect(daySpots.get('2026-08-14')).toHaveLength(1);
    expect(spots.size).toBe(1);
  });

  it('falls back to the pin when an event never named a city', () => {
    const { daySpots } = placesByDay(
      [event({ id: 'a', location: kyoto, startsAt: Date.UTC(2026, 7, 14, 0), timezone: TOKYO })],
      TOKYO,
    );

    expect(daySpots.get('2026-08-14')?.[0]?.label).toBe('Fushimi Inari');
  });

  it('passes over an event with no pin to ask about', () => {
    const { daySpots } = placesByDay(
      [
        event({ id: 'a', city: 'Kyoto', startsAt: Date.UTC(2026, 7, 14, 0), timezone: TOKYO }),
        event({ id: 'b', city: 'Osaka', location: osaka, startsAt: undefined }),
      ],
      TOKYO,
    );

    expect(daySpots.size).toBe(0);
  });

  it('puts a place on the day its own zone says, not the home one', () => {
    // Nine in the morning in Tokyo is the day before in London, and the day
    // this belongs to is the one it is lived on.
    const { daySpots } = placesByDay(
      [
        event({
          id: 'a',
          city: 'Kyoto',
          location: kyoto,
          startsAt: Date.UTC(2026, 7, 14, 0),
          timezone: TOKYO,
        }),
      ],
      'Europe/London',
    );

    expect([...daySpots.keys()]).toEqual(['2026-08-14']);
  });
});
