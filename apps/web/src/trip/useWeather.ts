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
interface Spot {
  lat: number;
  lng: number;
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
 * The forecast for each day, where that day is.
 *
 * A trip moves. The first pinned place in the whole trip used to answer for
 * every day of it, so a week in Kyoto followed by a week in Sapporo showed
 * Kyoto's weather throughout -- and nothing on screen said which city the
 * numbers were for. Each day now takes the first pinned place on that day, and
 * carries its name.
 *
 * Beyond the forecast horizon there is nothing to show and nothing is shown: a
 * made-up number for a date three months out would look exactly like a real one.
 */
export function useWeather(
  events: TripEvent[],
  homeTimezone: string,
): Map<DayKey, DailyWeather> {
  const [bySpot, setBySpot] = useState<Map<string, DailyWeather[]>>(new Map());

  /** Which place each day asks about, and the set of places to ask about. */
  const { dayToSpot, spots } = useMemo(() => {
    const dayToSpot = new Map<DayKey, Spot>();
    const spots = new Map<string, Spot>();

    for (const event of events) {
      const place = event.location;
      if (
        event.startsAt === undefined ||
        place?.lat === undefined ||
        place.lng === undefined
      ) {
        continue;
      }

      const day = dayKey(event.startsAt, event.timezone ?? homeTimezone);
      if (dayToSpot.has(day)) continue;

      const spot: Spot = { lat: place.lat, lng: place.lng, label: place.label };
      dayToSpot.set(day, spot);
      if (spots.size < MOST_SPOTS) spots.set(spotKey(spot.lat, spot.lng), spot);
    }

    return { dayToSpot, spots };
  }, [events, homeTimezone]);

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

    for (const [day, spot] of dayToSpot) {
      const forecast = bySpot
        .get(spotKey(spot.lat, spot.lng))
        ?.find((candidate) => candidate.date === day);

      if (forecast) byDay.set(day, forecast);
    }

    return byDay;
  }, [dayToSpot, bySpot]);
}
