import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import type { AppEnv } from '../context';

export interface AirportResult {
  code: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
  lat: number;
  lng: number;
}

const source = readFileSync(
  new URL('../../data/openflights-airports.dat', import.meta.url),
  'utf8',
);

/** The vendored OpenFlights snapshot, parsed once when the API starts. */
const airports = source
  .split(/\r?\n/)
  .map(readAirport)
  .filter((airport): airport is AirportResult => airport !== null);

/** Parses the subset of an OpenFlights airport row that the editor needs. */
export function readAirport(line: string): AirportResult | null {
  if (!line) return null;
  const fields = readCsvLine(line);
  const code = fields[4]?.toUpperCase();
  const timezone = fields[11];

  // The high-quality file currently contains airports only, but keeping the
  // type check makes a future refresh safe if OpenFlights changes the export.
  if (
    fields[12] !== 'airport' ||
    !code ||
    code === '\\N' ||
    !/^[A-Z0-9]{3}$/.test(code) ||
    !timezone ||
    timezone === '\\N'
  ) {
    return null;
  }

  return {
    code,
    name: fields[1] ?? code,
    city: fields[2] ?? '',
    country: fields[3] ?? '',
    lat: Number(fields[6]),
    lng: Number(fields[7]),
    timezone,
  };
}

/** A small CSV reader that handles quoted commas and doubled quotes. */
function readCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }

  fields.push(field);
  return fields;
}

export function airportRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/search', (c) => {
    const query = c.req.query('q')?.trim().toLowerCase() ?? '';
    if (query.length < 2) return c.json({ airports: [] });

    const words = query.split(/\s+/);
    const matches = airports
      .map((airport) => ({ airport, rank: rankAirport(airport, query, words) }))
      .filter((match) => match.rank < 10)
      .sort((a, b) => a.rank - b.rank || a.airport.code.localeCompare(b.airport.code))
      .slice(0, 8)
      .map((match) => match.airport);

    return c.json({ airports: matches });
  });

  return app;
}

/** Exact and prefix IATA matches lead; names, cities, and countries follow. */
function rankAirport(airport: AirportResult, query: string, words: string[]): number {
  const code = airport.code.toLowerCase();
  if (code === query) return 0;
  if (code.startsWith(query)) return 1;

  const name = airport.name.toLowerCase();
  const city = airport.city.toLowerCase();
  const country = airport.country.toLowerCase();
  if (city === query) return 2;
  if (name.startsWith(query)) return 3;
  if (city.startsWith(query)) return 4;

  const haystack = `${name} ${city} ${country}`;
  return words.every((word) => haystack.includes(word)) ? 5 : 10;
}
