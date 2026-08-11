import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';

/**
 * Nominatim asks callers to identify themselves and to stay under one request a
 * second. Both are conditions of the free service, so the proxy exists to meet
 * them in one place rather than hoping every browser does.
 */
const USER_AGENT = 'trip-planner/0.1 (https://github.com/mzhang28/trip-planner)';
const MIN_GAP_MS = 1100;

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WEATHER_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  at: number;
  body: unknown;
}

const cache = new Map<string, CacheEntry>();
let nextAllowedAt = 0;

function cached(key: string, ttl: number): unknown | null {
  const entry = cache.get(key);
  if (!entry || Date.now() - entry.at > ttl) return null;
  return entry.body;
}

function remember(key: string, body: unknown): void {
  cache.set(key, { at: Date.now(), body });
}

/** Waits its turn, so a burst of typing does not become a burst of requests. */
async function politely<T>(work: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, nextAllowedAt - Date.now());
  nextAllowedAt = Date.now() + wait + MIN_GAP_MS;

  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  return work();
}

export interface PlaceResult {
  label: string;
  address?: string;
  lat: number;
  lng: number;
}

export function placeRoutes() {
  const app = new Hono<AppEnv>();

  /** Turns what someone typed into somewhere on a map. */
  app.get('/search', async (c) => {
    const query = c.req.query('q')?.trim();
    if (!query || query.length < 3) return c.json({ places: [] });

    const key = `geocode:${query.toLowerCase()}`;
    const hit = cached(key, CACHE_TTL_MS);
    if (hit) return c.json(hit as { places: PlaceResult[] });

    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', '5');
      url.searchParams.set('addressdetails', '1');

      const response = await politely(() =>
        fetch(url, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'en' } }),
      );

      if (!response.ok) return c.json({ places: [] });

      const raw = (await response.json()) as Array<{
        name?: string;
        display_name?: string;
        lat: string;
        lon: string;
      }>;

      const places: PlaceResult[] = raw.map((row) => ({
        label: row.name || row.display_name?.split(',')[0] || query,
        address: row.display_name,
        lat: Number(row.lat),
        lng: Number(row.lon),
      }));

      const body = { places };
      remember(key, body);
      return c.json(body);
    } catch {
      // Looking up a place is a convenience. Failing it should leave someone
      // able to type an address by hand, not stop them saving the event.
      return c.json({ places: [] });
    }
  });

  return app;
}

const weatherQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export interface DailyWeather {
  date: string;
  code: number;
  max: number;
  min: number;
}

export function weatherRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/', async (c) => {
    const parsed = weatherQuery.safeParse({ lat: c.req.query('lat'), lng: c.req.query('lng') });
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

    // Rounded to about a kilometre. Two events in the same city share a
    // forecast, so the cache is worth something.
    const lat = Math.round(parsed.data.lat * 100) / 100;
    const lng = Math.round(parsed.data.lng * 100) / 100;
    const key = `weather:${lat},${lng}`;

    const hit = cached(key, WEATHER_TTL_MS);
    if (hit) return c.json(hit as { days: DailyWeather[] });

    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude', String(lat));
      url.searchParams.set('longitude', String(lng));
      url.searchParams.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min');
      url.searchParams.set('forecast_days', '16');
      url.searchParams.set('timezone', 'auto');

      const response = await fetch(url);
      if (!response.ok) return c.json({ days: [] });

      const raw = (await response.json()) as {
        daily?: {
          time: string[];
          weather_code: number[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
        };
      };

      const days: DailyWeather[] = (raw.daily?.time ?? []).map((date, index) => ({
        date,
        code: raw.daily!.weather_code[index] ?? 0,
        max: raw.daily!.temperature_2m_max[index] ?? 0,
        min: raw.daily!.temperature_2m_min[index] ?? 0,
      }));

      const body = { days };
      remember(key, body);
      return c.json(body);
    } catch {
      return c.json({ days: [] });
    }
  });

  return app;
}
