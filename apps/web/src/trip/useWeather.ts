import type { TripEvent } from '@trip/crdt';
import { useEffect, useState } from 'react';
import type { DayKey } from '../lib/calendar';

export interface DailyWeather {
  date: DayKey;
  code: number;
  max: number;
  min: number;
}

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
 * The forecast for wherever the trip is, by day.
 *
 * Keyed off the first event with coordinates on each day, so a week in one city
 * asks once. Beyond the forecast horizon there is nothing to show and nothing
 * is shown: a made-up number for a date three months out would look exactly
 * like a real one.
 */
export function useWeather(events: TripEvent[]): Map<DayKey, DailyWeather> {
  const [byDay, setByDay] = useState<Map<DayKey, DailyWeather>>(new Map());

  // A stable key so the effect runs when the place changes, not on every render.
  const anchor = events.find((event) => event.location?.lat !== undefined)?.location;
  const lat = anchor?.lat;
  const lng = anchor?.lng;

  useEffect(() => {
    if (lat === undefined || lng === undefined) {
      setByDay(new Map());
      return;
    }

    let live = true;

    void fetch(`/api/weather?lat=${lat}&lng=${lng}`)
      .then((res) => res.json() as Promise<{ days: DailyWeather[] }>)
      .then((body) => {
        if (!live) return;
        setByDay(new Map(body.days.map((day) => [day.date, day])));
      })
      .catch(() => {
        // Offline, or the upstream is down. A calendar with no weather on it is
        // still a calendar.
      });

    return () => {
      live = false;
    };
  }, [lat, lng]);

  return byDay;
}
