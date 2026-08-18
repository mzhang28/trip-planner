import type { TripEvent } from '@trip/crdt';
import { useEffect, useMemo, useState } from 'react';
import type { DayKey } from '../lib/calendar';
import { dayKey } from '../lib/time';

export interface DailyWeather {
  date: DayKey;
  code: number;
  max: number;
  min: number;
  /** Where this forecast is for, so a calendar can say which city it describes. */
  place?: string;
}

/** A place asked about once, however many days or events sit on it. */
export interface Spot {
  lat: number;
  lng: number;
  /** The city, so a day that touches two of them can name both. */
  label: string;
}

/*
 * Rounded before it is used as a key, so two events in the same city ask one
 * question between them rather than one each.
 */
function spotKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/** No more than this many places per view, to stay inside the upstream's rate. */
const MOST_SPOTS = 8;

/** WMO weather codes, grouped to the handful of things worth telling apart. */
export function weatherGlyph(code: number): { icon: string; label: string } {
  if (code === 0) return { icon: '☀', label: 'Clear' };
  if (code <= 2) return { icon: '⛅', label: 'Some cloud' };
  if (code === 3) return { icon: '☁', label: 'Cloudy' };
  if (code <= 48) return { icon: '≡', label: 'Fog' };
  if (code <= 57) return { icon: '⛆', label: 'Drizzle' };
  if (code <= 67) return { icon: '☂', label: 'Rain' };
  if (code <= 77) return { icon: '❄', label: 'Snow' };
  if (code <= 82) return { icon: '☂', label: 'Showers' };
  if (code <= 86) return { icon: '❄', label: 'Snow showers' };
  return { icon: '⚡', label: 'Thunderstorm' };
}

/**
 * One reading for a day, from every city that day is spent in.
 *
 * The high is the highest of them and the low the lowest, because what the
 * numbers are for is knowing what to carry. A morning in Sapporo and an evening
 * in Naha is both a cold day and a warm one, and a person packs for both; the
 * warmer city's low says nothing about the morning.
 */
export function combineForecasts(date: DayKey, found: DailyWeather[]): DailyWeather {
  const cities: string[] = [];
  for (const one of found) {
    if (one.place && !cities.includes(one.place)) cities.push(one.place);
  }

  return {
    date,
    max: Math.max(...found.map((one) => one.max)),
    min: Math.min(...found.map((one) => one.min)),
    /*
     * WMO codes climb with how much the weather is worth knowing about, from 0
     * for a clear sky to the nineties for a thunderstorm, so the highest of
     * them is the one worth putting on the day. Rain in the city you land in
     * is the thing to know, whatever it was doing in the one you left.
     */
    code: Math.max(...found.map((one) => one.code)),
    place: cities.length > 1 ? `${cities.slice(0, -1).join(', ')} and ${cities.at(-1)}` : cities[0],
  };
}

/**
 * Every city each day is spent in, and the places to ask the forecast of.
 *
 * A day is listed against a city rather than against each pinned place, so a
 * day with three stops around Kyoto asks once and says "Kyoto" rather than
 * naming three temples. An event that never named a city falls back to what its
 * pin is called.
 *
 * `spots` is capped, so a long trip asks about the first several places it
 * meets and the rest of its days go without. A day whose cities are all past
 * the cap shows nothing, which is what it showed before there was a cap.
 */
export function placesByDay(
  events: TripEvent[],
  homeTimezone: string,
): { daySpots: Map<DayKey, Spot[]>; spots: Map<string, Spot> } {
  const daySpots = new Map<DayKey, Spot[]>();
  const spots = new Map<string, Spot>();

  for (const event of events) {
    const place = event.location;
    if (event.startsAt === undefined || place?.lat === undefined || place.lng === undefined) {
      continue;
    }

    const label = event.city || place.label;
    const day = dayKey(event.startsAt, event.timezone ?? homeTimezone);

    const onThatDay = daySpots.get(day) ?? [];
    if (onThatDay.some((candidate) => candidate.label === label)) continue;

    const spot: Spot = { lat: place.lat, lng: place.lng, label };
    onThatDay.push(spot);
    daySpots.set(day, onThatDay);
    if (spots.size < MOST_SPOTS) spots.set(spotKey(spot.lat, spot.lng), spot);
  }

  return { daySpots, spots };
}

/**
 * The forecast for each day, from wherever that day is spent.
 *
 * A trip moves, and it can move inside one day. Each day asks about every city
 * it touches and reports the range across all of them, so a day that flies from
 * Sapporo to Naha reads as the cold morning and the warm evening it was. Taking
 * the first place on the day, which is what this did, described the morning and
 * called it the day.
 *
 * Beyond the forecast horizon there is nothing to show and nothing is shown: a
 * made-up number for a date three months out would look exactly like a real one.
 */
export function useWeather(events: TripEvent[], homeTimezone: string): Map<DayKey, DailyWeather> {
  const [bySpot, setBySpot] = useState<Map<string, DailyWeather[]>>(new Map());

  const { daySpots, spots } = useMemo(
    () => placesByDay(events, homeTimezone),
    [events, homeTimezone],
  );

  // A stable list, so the effect runs when the places change rather than on
  // every render of every event.
  const asked = [...spots.keys()].sort().join('|');

  useEffect(() => {
    if (spots.size === 0) {
      setBySpot(new Map());
      return;
    }

    let live = true;

    void Promise.all(
      [...spots.values()].map(async (spot) => {
        const res = await fetch(`/api/weather?lat=${spot.lat}&lng=${spot.lng}`);
        const body = (await res.json()) as { days: DailyWeather[] };

        return [
          spotKey(spot.lat, spot.lng),
          body.days.map((day) => ({ ...day, place: spot.label })),
        ] as const;
      }),
    )
      .then((pairs) => {
        if (live) setBySpot(new Map(pairs));
      })
      .catch(() => {
        // Offline, or the upstream is down. A calendar with no weather on it is
        // still a calendar.
      });

    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  return useMemo(() => {
    const byDay = new Map<DayKey, DailyWeather>();

    for (const [day, onThatDay] of daySpots) {
      // A city whose forecast has not arrived, or that fell outside the places
      // this view asks about, leaves the rest of the day's cities to answer.
      const found = onThatDay
        .map((spot) =>
          bySpot.get(spotKey(spot.lat, spot.lng))?.find((candidate) => candidate.date === day),
        )
        .filter((forecast): forecast is DailyWeather => forecast !== undefined);

      if (found.length > 0) byDay.set(day, combineForecasts(day, found));
    }

    return byDay;
  }, [daySpots, bySpot]);
}
