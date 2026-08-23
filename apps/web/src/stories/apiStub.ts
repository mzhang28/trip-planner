import { HOME_TIMEZONE, PACIFIC, TOKYO, japanWeather } from './japan';

/**
 * The server, as far as a story is concerned.
 *
 * Components that look things up — a place, an airport, the forecast, who a
 * trip is shared with — do it over `fetch`, and a catalogue has no server to
 * answer. Without this they render their offline state forever, which is one
 * of the states worth looking at and a poor default for the other five.
 *
 * `fetch` is replaced rather than the components being given an injected
 * client: the seam the app actually has is the network, and stubbing there
 * means a story runs the same code paths, timing and all, that a browser does.
 * Anything not under `/api` is passed through, so map tiles and fonts still
 * load.
 */

const original = globalThis.fetch;
let installed = false;

/** How long an answer takes, so loading states are visible rather than theoretical. */
const LATENCY_MS = 180;

interface Airport {
  code: string;
  name: string;
  city: string;
  country: string;
  timezone: string;
  lat: number;
  lng: number;
}

const AIRPORTS: Airport[] = [
  {
    code: 'BOS',
    name: 'Logan International',
    city: 'Boston',
    country: 'United States',
    timezone: HOME_TIMEZONE,
    lat: 42.3656,
    lng: -71.0096,
  },
  {
    code: 'SFO',
    name: 'San Francisco International',
    city: 'San Francisco',
    country: 'United States',
    timezone: PACIFIC,
    lat: 37.6188,
    lng: -122.3754,
  },
  {
    code: 'NRT',
    name: 'Narita International',
    city: 'Tokyo',
    country: 'Japan',
    timezone: TOKYO,
    lat: 35.7647,
    lng: 140.3863,
  },
  {
    code: 'HND',
    name: 'Haneda',
    city: 'Tokyo',
    country: 'Japan',
    timezone: TOKYO,
    lat: 35.5523,
    lng: 139.7798,
  },
  {
    code: 'KIX',
    name: 'Kansai International',
    city: 'Osaka',
    country: 'Japan',
    timezone: TOKYO,
    lat: 34.4347,
    lng: 135.2441,
  },
  {
    code: 'ITM',
    name: 'Osaka International',
    city: 'Osaka',
    country: 'Japan',
    timezone: TOKYO,
    lat: 34.7855,
    lng: 135.4382,
  },
  {
    code: 'HIJ',
    name: 'Hiroshima',
    city: 'Hiroshima',
    country: 'Japan',
    timezone: TOKYO,
    lat: 34.4361,
    lng: 132.9195,
  },
  {
    code: 'JFK',
    name: 'John F. Kennedy International',
    city: 'New York',
    country: 'United States',
    timezone: HOME_TIMEZONE,
    lat: 40.6413,
    lng: -73.7781,
  },
];

interface PlaceResult {
  label: string;
  address?: string;
  lat: number;
  lng: number;
}

const PLACES: PlaceResult[] = [
  {
    label: 'Fushimi Inari Taisha',
    address: '68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto',
    lat: 34.9671,
    lng: 135.7727,
  },
  {
    label: 'Arashiyama Bamboo Grove',
    address: 'Ukyo Ward, Kyoto, Kyoto Prefecture',
    lat: 35.0175,
    lng: 135.6717,
  },
  {
    label: 'Meiji Jingu',
    address: '1-1 Yoyogikamizonocho, Shibuya City, Tokyo',
    lat: 35.6764,
    lng: 139.6993,
  },
  { label: 'Ueno Park', address: 'Uenokoen, Taito City, Tokyo', lat: 35.7148, lng: 139.7737 },
  {
    label: 'teamLab Borderless',
    address: 'Azabudai Hills, Minato City, Tokyo',
    lat: 35.6605,
    lng: 139.7392,
  },
  {
    label: 'Himeji Castle',
    address: '68 Honmachi, Himeji, Hyogo Prefecture',
    lat: 34.8394,
    lng: 134.694,
  },
  { label: 'Ōkunoshima', address: 'Takehara, Hiroshima Prefecture', lat: 34.3091, lng: 132.9938 },
  {
    label: 'Shimokitazawa',
    address: 'Kitazawa, Setagaya City, Tokyo',
    lat: 35.6613,
    lng: 139.6679,
  },
  {
    label: 'Palo Alto',
    address: 'Santa Clara County, California, United States',
    lat: 37.4443,
    lng: -122.1598,
  },
];

const ACCESS = {
  you: 'u_michael',
  links: [
    {
      id: 'sl_1',
      role: 'editor' as const,
      createdAt: Date.parse('2026-04-02T18:11:00Z'),
      expiresAt: null,
      revokedAt: null,
    },
    {
      id: 'sl_2',
      role: 'viewer' as const,
      createdAt: Date.parse('2026-03-28T09:02:00Z'),
      expiresAt: Date.parse('2026-06-30T09:02:00Z'),
      revokedAt: null,
    },
    {
      id: 'sl_3',
      role: 'editor' as const,
      createdAt: Date.parse('2026-02-14T21:40:00Z'),
      expiresAt: null,
      revokedAt: Date.parse('2026-03-01T10:00:00Z'),
    },
  ],
  members: [
    {
      userId: 'u_michael',
      role: 'owner' as const,
      name: 'Michael',
      firstOpenedAt: Date.parse('2026-02-14T21:39:00Z'),
    },
    {
      userId: 'u_jasmine',
      role: 'editor' as const,
      name: 'Jasmine',
      firstOpenedAt: Date.parse('2026-04-02T18:30:00Z'),
    },
    {
      userId: 'u_tim',
      role: 'viewer' as const,
      name: 'Tim Uso',
      firstOpenedAt: Date.parse('2026-04-11T02:12:00Z'),
    },
  ],
};

/**
 * The calendar subscriptions a trip has handed out.
 *
 * One that something is polling, one that was made and never used, and one
 * narrowed to what is booked -- which is the row that says what the option
 * does without anybody having to tick it.
 */
const CALENDAR_FEEDS = [
  {
    id: 'cf_1',
    label: 'My phone',
    confirmedOnly: false,
    createdAt: Date.parse('2026-04-02T18:12:00Z'),
    createdBy: 'u_michael',
    createdByName: 'Michael',
    lastFetchedAt: Date.now() - 40 * 60_000,
    fetchCount: 214,
  },
  {
    id: 'cf_2',
    label: "Jasmine's work calendar",
    confirmedOnly: true,
    createdAt: Date.parse('2026-04-03T08:30:00Z'),
    createdBy: 'u_jasmine',
    createdByName: 'Jasmine',
    lastFetchedAt: Date.now() - 3 * 60 * 60_000,
    fetchCount: 96,
  },
  {
    id: 'cf_3',
    label: null,
    confirmedOnly: false,
    createdAt: Date.parse('2026-04-11T02:15:00Z'),
    createdBy: 'u_michael',
    createdByName: 'Michael',
    lastFetchedAt: null,
    fetchCount: 0,
  },
];

const NEW_CALENDAR_FEED = {
  id: 'cf_4',
  url: 'https://trips.example/calendar/uOtY3n3Rk8pQvW2xLd7fJqA1sB4cE6gH9iK0mN2oP5r.ics',
  webcalUrl: 'webcal://trips.example/calendar/uOtY3n3Rk8pQvW2xLd7fJqA1sB4cE6gH9iK0mN2oP5r.ics',
  label: null,
  confirmedOnly: false,
};

const AUDIT = [
  {
    id: 'a_1',
    source: 'mcp' as const,
    clientId: 'claude-desktop',
    toolName: 'add_event',
    summary: 'Added “Get uji matcha :3” on 26 May',
    createdAt: Date.now() - 4 * 60_000,
    undoneAt: null,
    undoable: true,
    restoresFields: false,
    actor: 'Claude',
  },
  {
    id: 'a_2',
    source: 'mcp' as const,
    clientId: 'claude-desktop',
    toolName: 'update_event',
    summary: 'Set the confirmation code on “KOKO HOTEL Hiroshima Ekimae”',
    createdAt: Date.now() - 52 * 60_000,
    undoneAt: null,
    undoable: true,
    restoresFields: true,
    actor: 'Claude',
  },
  {
    id: 'a_3',
    source: 'mcp' as const,
    clientId: 'some-agent',
    toolName: 'delete_event',
    summary: 'Deleted “tokyo tower”',
    createdAt: Date.now() - 30 * 60 * 60_000,
    undoneAt: Date.now() - 29 * 60 * 60_000,
    undoable: false,
    restoresFields: false,
    actor: 'An agent',
  },
  {
    id: 'a_4',
    source: 'web' as const,
    clientId: null,
    toolName: 'import_trip',
    summary: 'Imported 54 events from an archive',
    createdAt: Date.now() - 6 * 24 * 60 * 60_000,
    undoneAt: null,
    undoable: false,
    restoresFields: false,
    actor: 'Michael',
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function matches(needle: string, ...haystack: string[]): boolean {
  const text = needle.trim().toLowerCase();
  return haystack.some((one) => one.toLowerCase().includes(text));
}

async function answer(url: URL, init: RequestInit | undefined): Promise<Response | null> {
  const path = url.pathname;
  const query = url.searchParams.get('q') ?? '';

  if (path === '/api/me') {
    return json({
      userId: 'u_michael',
      displayName: 'Michael',
      admin: true,
      registrationOpen: false,
    });
  }

  if (path === '/api/airports/search') {
    return json({
      airports: AIRPORTS.filter((one) => matches(query, one.code, one.name, one.city)).slice(0, 8),
    });
  }

  if (path === '/api/places/search') {
    return json({
      places: PLACES.filter((one) => matches(query, one.label, one.address ?? '')).slice(0, 8),
    });
  }

  if (path === '/api/weather') {
    return json({ days: [...japanWeather().values()].map(({ place: _place, ...day }) => day) });
  }

  if (path.startsWith('/api/audit/')) {
    if (path.endsWith('/undo')) return json({ ok: true });

    const source = url.searchParams.get('source');
    return json({ entries: source ? AUDIT.filter((one) => one.source === source) : AUDIT });
  }

  if (path.endsWith('/calendar')) {
    if (init?.method === 'POST') return json(NEW_CALENDAR_FEED, 201);
    return json({ feeds: CALENDAR_FEEDS, you: 'u_michael' });
  }

  // Revoking a feed: accepted, and the reload after one shows the same list,
  // the same as a share link below.
  if (path.includes('/calendar/') && init?.method) return json({ ok: true });

  if (path.endsWith('/access')) return json(ACCESS);
  if (path.endsWith('/share')) return json({ token: 'demo-share-token', role: 'editor' });

  // Revokes and role changes: accepted, and the reload after one shows the
  // same list. A story about sharing is about the layout, not the bookkeeping.
  if (path.includes('/access/') && init?.method) return json({ ok: true });

  return null;
}

export function installApiStub(): void {
  if (installed) return;
  installed = true;

  globalThis.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, location.origin);

    if (!url.pathname.startsWith('/api/')) return original(input, init);

    const body = await answer(url, init);
    if (!body) return json({ error: 'not stubbed' }, 404);

    await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
    return body;
  };
}
