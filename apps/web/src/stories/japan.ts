import {
  addEvent,
  addFieldDef,
  addLink,
  addTodo,
  createTrip,
  liveEvents,
  liveFieldDefs,
  setCityColor,
  setCustomField,
  updateEvent,
  updateTodo,
  updateTripMeta,
  type Author,
  type Doc,
  type EditableEventFields,
  type FieldDef,
  type TripEvent,
} from '@trip/crdt';
import { daysInRange, type DayKey } from '../lib/calendar';
import { daySlots, type DaySlot } from '../lib/dayZones';
import type { DailyWeather } from '../trip/useWeather';

/**
 * One trip, fixed, for every story to be drawn against.
 *
 * It is a real itinerary — Boston to Japan by way of San Francisco, three
 * weeks in May 2026 — because made-up data hides the things worth looking at.
 * A real trip has a twenty-item list of ideas with no dates on them, hotel
 * names longer than the column they sit in, three time zones in one week, and
 * a day where everything is stacked between nine and noon. Those are the cases
 * the styling has to survive, and they only show up when the data is somebody's
 * actual plan rather than "Event 1" through "Event 8".
 *
 * The document is a real Automerge document built through the same functions
 * the app calls, so anything a story does to it behaves the way it would in
 * the app. Nothing here talks to a server; see `apiStub.ts` for that half.
 */

export const HOME_TIMEZONE = 'America/New_York';
export const TOKYO = 'Asia/Tokyo';
export const PACIFIC = 'America/Los_Angeles';

/** The day stories treat as today: the second morning in Tokyo. */
export const TODAY: DayKey = '2026-05-22';

export const TRIP_START: DayKey = '2026-05-19';
export const TRIP_END: DayKey = '2026-06-05';

const AUTHOR: Author = { userId: 'u_michael', now: Date.parse('2026-05-01T12:00:00Z') };
const OTHER: Author = { userId: 'u_jasmine', now: Date.parse('2026-05-02T09:30:00Z') };

interface Seed extends Partial<EditableEventFields> {
  id: string;
  name: string;
  /** Local wall clock in the event's own zone, as `YYYY-MM-DD HH:MM`. */
  at?: string;
  links?: Array<[url: string, title?: string]>;
  /** Named apart from the document's own `todos`, which this seeds through addTodo. */
  checklist?: Array<[text: string, done?: boolean, deadline?: string]>;
}

/*
 * The ideas nobody has placed yet.
 *
 * Every trip has this pile and it is where a list view earns or loses its
 * keep: a name and nothing else, sometimes not even a city.
 */
const IDEAS: Seed[] = [
  { id: 'e_idea_inari', name: 'Fushimi Inari Taisha', city: 'Kyoto', durationMinutes: 120 },
  { id: 'e_idea_omotesando', name: 'omotesando' },
  { id: 'e_idea_wagashi', name: 'wagashi class' },
  { id: 'e_idea_tower', name: 'tokyo tower', city: 'Tokyo' },
  { id: 'e_idea_shimokita', name: 'shimokitazawa', city: 'Tokyo' },
  { id: 'e_idea_amanohashidate', name: 'amanohashidate' },
  { id: 'e_idea_jiro', name: 'ramen jiro' },
  { id: 'e_idea_teto', name: 'teto store' },
  { id: 'e_idea_meiji', name: 'meiji jingu', city: 'Tokyo' },
  { id: 'e_idea_shojin', name: 'shojin ryori class' },
  { id: 'e_idea_shoes', name: 'buy jasmine shoes' },
  { id: 'e_idea_lostbar', name: 'lost bar', city: 'Tokyo' },
  { id: 'e_idea_tea', name: 'tea ceremony' },
  { id: 'e_idea_goma', name: 'goma tofu' },
  { id: 'e_idea_ueno', name: 'ueno park', city: 'Tokyo' },
  { id: 'e_idea_cablecar', name: 'cable car' },
  { id: 'e_idea_kamakura', name: 'kamakura day trip' },
  { id: 'e_idea_kirby', name: 'kirby cafe' },
  { id: 'e_idea_yoyogi', name: 'yoyogi park' },
  {
    id: 'e_idea_teamlab',
    name: 'teamlab borderless',
    city: 'Tokyo',
    booking: {
      status: 'idea',
      note: 'Tickets go on sale a month ahead and sell out the same day.',
    },
    links: [['https://www.teamlab.art/e/borderless-azabudai/', 'teamLab Borderless']],
  },
];

/*
 * The plan as it stands. Times are local wall clocks in each event's own zone,
 * which is the only way to write an itinerary that crosses the Pacific without
 * doing arithmetic in your head.
 */
const PLANNED: Seed[] = [
  {
    id: 'e_bos_sfo',
    name: 'BOS → SFO',
    kind: 'transit',
    at: '2026-05-19 16:45',
    timezone: HOME_TIMEZONE,
    durationMinutes: 394,
    booking: { status: 'booked', confirmationCode: 'K7QLM2' },
    location: {
      label: 'Logan International Airport',
      address: 'Logan International Airport, 1 Harborside Drive, East Boston, Boston, MA 02128',
      lat: 42.3631767,
      lng: -71.0136401,
    },
    transit: {
      method: 'flight',
      operator: 'JetBlue',
      number: 'B6 615',
      from: 'BOS',
      to: 'SFO',
      fromCity: 'Boston',
      toCity: 'San Francisco',
      departsTz: HOME_TIMEZONE,
      arrivesTz: PACIFIC,
      seat: '11A',
      terminal: 'C',
      gate: 'C31',
    },
  },
  {
    id: 'e_sfo_hotel_out',
    name: 'Holiday Inn Express Union Square',
    kind: 'lodging',
    at: '2026-05-19 18:40',
    timezone: PACIFIC,
    city: 'San Francisco',
    durationMinutes: 1140,
    booking: { status: 'booked', confirmationCode: '84120973' },
    lodging: { address: '480 Sutter St, San Francisco, CA 94108' },
  },
  {
    id: 'e_dinner_tim',
    name: 'Dinner w/ Tim Uso',
    at: '2026-05-19 22:00',
    timezone: PACIFIC,
    city: 'San Francisco',
    durationMinutes: 165,
    booking: { status: 'booked', note: 'He is driving up, so anywhere near the station.' },
    location: {
      label: 'Palo Alto',
      address: 'Palo Alto, Santa Clara County, California, United States',
      lat: 37.4443293,
      lng: -122.1598465,
    },
    transitIn: { minutes: 55, mode: 'drive', note: 'Tim collects us from the hotel' },
  },
  {
    id: 'e_sfo_nrt',
    name: 'SFO → NRT',
    kind: 'transit',
    at: '2026-05-20 20:15',
    timezone: PACIFIC,
    durationMinutes: 645,
    booking: { status: 'booked', confirmationCode: 'ZK4TP9' },
    description: 'Bag drop closes 60 min before. Seats are together from row 41.',
    transit: {
      method: 'flight',
      operator: 'ZIPAIR',
      number: 'ZG 25',
      from: 'SFO',
      to: 'NRT',
      fromCity: 'San Francisco',
      toCity: 'Tokyo',
      departsTz: PACIFIC,
      arrivesTz: TOKYO,
      seat: '41H',
      terminal: 'I',
    },
    checklist: [
      ['Check in 24h before', false, '2026-05-19'],
      ['Print the Visit Japan QR codes', true],
    ],
  },
  {
    id: 'e_ueno_stay',
    name: 'Sotetsu Fresa Inn Ueno',
    kind: 'lodging',
    at: '2026-05-22 15:00',
    timezone: TOKYO,
    city: 'Tokyo',
    durationMinutes: 5460,
    booking: { status: 'booked', confirmationCode: 'JP-88214' },
    lodging: { address: '2-14-8 Higashiueno, Taito City, Tokyo 110-0015' },
    location: { label: 'Sotetsu Fresa Inn Ueno', lat: 35.7118, lng: 139.7772 },
  },
  {
    id: 'e_skyliner_in',
    name: 'Keisei Skyliner → Ueno',
    kind: 'transit',
    at: '2026-05-22 09:00',
    timezone: TOKYO,
    city: 'Tokyo',
    durationMinutes: 45,
    transit: { method: 'train', operator: 'Keisei', from: 'Narita T1', to: 'Keisei Ueno' },
  },
  {
    id: 'e_harry',
    name: 'Harry mogumogu',
    at: '2026-05-22 13:00',
    timezone: TOKYO,
    city: 'Tokyo',
    durationMinutes: 45,
  },
  {
    id: 'e_chiikawa',
    name: 'Chiikawa park',
    at: '2026-05-22 15:00',
    timezone: TOKYO,
    city: 'Tokyo',
    durationMinutes: 45,
  },
  {
    id: 'e_haute',
    name: 'Haute couture cafe omotesando',
    at: '2026-05-22 17:00',
    timezone: TOKYO,
    city: 'Tokyo',
    durationMinutes: 30,
  },
  {
    id: 'e_go_kyoto',
    name: 'GO TO KYOTO',
    kind: 'transit',
    at: '2026-05-25 15:00',
    timezone: TOKYO,
    city: 'Kyoto',
    durationMinutes: 135,
    booking: { status: 'idea' },
    transit: {
      method: 'train',
      operator: 'JR Tokai',
      number: 'Nozomi 231',
      from: 'Tokyo',
      to: 'Kyoto',
      fromCity: 'Tokyo',
      toCity: 'Kyoto',
      coach: '7',
      seat: '11D/E',
      platform: '17',
    },
  },
  {
    id: 'e_uji',
    name: 'Get uji matcha :3',
    at: '2026-05-26 00:00',
    timeUndecided: true,
    timezone: TOKYO,
    city: 'Kyoto',
    location: { label: 'Myoraku-38 Uji, Kyoto 611-0021, Japan' },
  },
  {
    id: 'e_kyoto_stay',
    name: 'Sotetsu Fresa Inn Kyoto-Kiyomizu Gojo',
    kind: 'lodging',
    at: '2026-05-26 08:00',
    timezone: TOKYO,
    city: 'Kyoto',
    durationMinutes: 2580,
    booking: { status: 'booked', confirmationCode: 'KY-4471' },
  },
  {
    id: 'e_arashiyama',
    name: 'Arashiyama bamboo forest',
    at: '2026-05-27 16:30',
    timezone: TOKYO,
    city: 'Kyoto',
    durationMinutes: 150,
    location: {
      label: 'Arashiyama',
      address: 'Arashiyama, Nishikyo Ward, Kyoto, Kyoto Prefecture, 615-0000, Japan',
      lat: 35.0090473,
      lng: 135.6744961,
    },
    transitIn: { minutes: 35, mode: 'transit', note: 'JR Sagano line from Kyoto' },
  },
  {
    id: 'e_momijiya_shuttle',
    name: 'Shuttle to Momijiya (JR Hanazono 16:10)',
    kind: 'transit',
    at: '2026-05-27 20:10',
    timezone: TOKYO,
    city: 'Kyoto',
    durationMinutes: 20,
    transit: { method: 'car', operator: 'Momiji-ya', from: 'JR Hanazono', to: 'Momiji-ya' },
  },
  {
    id: 'e_momijiya',
    name: 'Momijiya Annex',
    kind: 'lodging',
    at: '2026-05-27 20:30',
    timezone: TOKYO,
    city: 'Kyoto',
    durationMinutes: 1060,
    booking: {
      status: 'booked',
      note: 'Dinner is at 18:30 sharp, kaiseki. Bath is open until 23:00.',
    },
    location: {
      label: 'Momiji-ya',
      address: 'Momiji-ya, Shuuzan Highway, Umegahata-Yamasakicho, Ukyō Ward, Kyoto 616-0000',
      lat: 35.0557015,
      lng: 135.6737521,
    },
  },
  {
    id: 'e_go_osaka',
    name: 'GO TO OSAKA',
    kind: 'transit',
    at: '2026-05-28 17:15',
    timezone: TOKYO,
    city: 'Osaka',
    durationMinutes: 30,
    transit: { method: 'train', from: 'Kyoto', to: 'Osaka', fromCity: 'Kyoto', toCity: 'Osaka' },
  },
  {
    id: 'e_osaka_stay',
    name: 'Vessel Inn Osaka',
    kind: 'lodging',
    at: '2026-05-28 19:00',
    timezone: TOKYO,
    city: 'Osaka',
    durationMinutes: 3360,
    booking: { status: 'booked', confirmationCode: 'VI-2299' },
  },
  {
    id: 'e_himeji_leg',
    name: 'Osaka → Himeji',
    kind: 'transit',
    at: '2026-05-30 12:00',
    timezone: TOKYO,
    city: 'Himeji',
    durationMinutes: 30,
    transit: { method: 'train', from: 'Shin-Osaka', to: 'Himeji' },
  },
  {
    id: 'e_himeji_castle',
    name: 'Himeji Castle',
    at: '2026-05-30 12:30',
    timezone: TOKYO,
    city: 'Himeji',
    durationMinutes: 120,
    location: {
      label: 'Himeji Castle',
      address: '68 Honmachi, Himeji, Hyogo Prefecture, 670-0012, Japan',
      lat: 34.8393313,
      lng: 134.69402,
    },
    // Fifteen minutes' walk with no minutes between the train and the ticket
    // gate: the case the leg exists to point at.
    transitIn: { minutes: 15, mode: 'walk', note: 'North up the avenue from the station' },
  },
  {
    id: 'e_onomichi_leg',
    name: 'Himeji → Onomichi',
    kind: 'transit',
    at: '2026-05-30 14:30',
    timezone: TOKYO,
    city: 'Onomichi',
    durationMinutes: 70,
    transit: { method: 'train', from: 'Himeji', to: 'Onomichi' },
  },
  {
    id: 'e_onomichi',
    name: 'Onomichi',
    at: '2026-05-30 16:00',
    timezone: TOKYO,
    city: 'Onomichi',
    durationMinutes: 90,
    location: {
      label: 'Onomichi',
      address: 'Onomichi, Hiroshima Prefecture, Japan',
      lat: 34.4088519,
      lng: 133.2051549,
    },
  },
  {
    id: 'e_mihara_leg',
    name: 'Onomichi → Mihara',
    kind: 'transit',
    at: '2026-05-30 17:30',
    timezone: TOKYO,
    city: 'Mihara',
    durationMinutes: 20,
    transit: { method: 'train', from: 'Onomichi', to: 'Mihara' },
  },
  {
    id: 'e_bunnies',
    name: 'Mihara → bunnies',
    at: '2026-05-30 17:50',
    timezone: TOKYO,
    city: 'Ōkunoshima',
    durationMinutes: 240,
    description:
      'Ferry from Tadanoumi. Buy rabbit food at the station, there is none on the island.',
    location: {
      label: 'Ōkunoshima',
      address: 'Ōkunoshima, Takehara, Hiroshima Prefecture, Japan',
      lat: 34.3091206,
      lng: 132.9937586,
    },
  },
  {
    id: 'e_hiroshima_leg',
    name: 'Mihara → Hiroshima',
    kind: 'transit',
    at: '2026-05-30 21:50',
    timezone: TOKYO,
    city: 'Hiroshima',
    durationMinutes: 30,
    transit: { method: 'train', from: 'Mihara', to: 'Hiroshima' },
  },
  {
    id: 'e_hiroshima_stay',
    name: 'KOKO HOTEL Hiroshima Ekimae',
    kind: 'lodging',
    at: '2026-05-31 08:20',
    timezone: TOKYO,
    city: 'Hiroshima',
    durationMinutes: 2580,
    booking: { status: 'booked', confirmationCode: 'oops' },
  },
  {
    id: 'e_miyajima',
    name: 'MIYAJIMA',
    at: '2026-05-31 14:35',
    timezone: TOKYO,
    city: 'Hiroshima',
    durationMinutes: 345,
    location: { label: 'Itsukushima Shrine', lat: 34.2959, lng: 132.3197 },
  },
  {
    id: 'e_hiroshima_free',
    name: 'FUCK AROUND IN HIROSHIMA MISCELLANEOUSLY',
    at: '2026-05-31 20:35',
    timezone: TOKYO,
    city: 'Hiroshima',
    durationMinutes: 315,
  },
  {
    id: 'e_back_tokyo',
    name: 'GO TO TOKYO VIA SHINKANSEN',
    kind: 'transit',
    at: '2026-06-01 17:20',
    timezone: TOKYO,
    city: 'Tokyo',
    durationMinutes: 235,
    booking: { status: 'idea' },
    transit: {
      method: 'train',
      operator: 'JR West',
      number: 'Nozomi 34',
      from: 'Hiroshima',
      to: 'Tokyo',
      fromCity: 'Hiroshima',
      toCity: 'Tokyo',
    },
  },
  {
    id: 'e_skyliner_out',
    name: 'Keisei Skyliner → Narita Airport',
    kind: 'transit',
    at: '2026-06-04 22:10',
    timezone: TOKYO,
    city: 'Narita',
    durationMinutes: 45,
    transit: { method: 'train', operator: 'Keisei', from: 'Keisei Ueno', to: 'Narita T1' },
  },
  {
    id: 'e_nrt_sfo',
    name: 'NRT → SFO',
    kind: 'transit',
    at: '2026-06-05 02:10',
    timezone: TOKYO,
    durationMinutes: 585,
    booking: { status: 'booked', confirmationCode: 'ZK4TP9' },
    transit: {
      method: 'flight',
      operator: 'ZIPAIR',
      number: 'ZG 26',
      from: 'NRT',
      to: 'SFO',
      fromCity: 'Tokyo',
      toCity: 'San Francisco',
      departsTz: TOKYO,
      arrivesTz: PACIFIC,
      seat: '41H',
    },
  },
  {
    id: 'e_sfo_hotel_back',
    name: 'Holiday Inn Express Union Square',
    kind: 'lodging',
    at: '2026-06-04 15:00',
    timezone: PACIFIC,
    city: 'San Francisco',
    durationMinutes: 1140,
    booking: { status: 'idea' },
  },
  {
    id: 'e_sfo_bos',
    name: 'SFO → BOS',
    kind: 'transit',
    at: '2026-06-05 01:00',
    timezone: PACIFIC,
    durationMinutes: 351,
    booking: { status: 'booked', confirmationCode: 'K7QLM2' },
    transit: {
      method: 'flight',
      operator: 'JetBlue',
      number: 'B6 616',
      from: 'SFO',
      to: 'BOS',
      fromCity: 'San Francisco',
      toCity: 'Boston',
      departsTz: PACIFIC,
      arrivesTz: HOME_TIMEZONE,
    },
  },
  {
    id: 'e_note_cash',
    name: 'Cash, not cards',
    kind: 'note',
    at: '2026-05-22 08:00',
    timeUndecided: true,
    timezone: TOKYO,
    description:
      'Most of the small places in Ueno are cash only. Seven Bank ATMs take our cards, the post office ones do not.',
  },
];

export const FIELD_DEFS: FieldDef[] = [
  { id: 'f_cost', label: 'Cost per person', type: 'money', currency: 'JPY', order: 0 },
  { id: 'f_walk', label: 'Walk from station', type: 'number', unit: 'min', order: 1 },
  { id: 'f_needs_booking', label: 'Needs booking', type: 'checkbox', order: 2 },
  {
    id: 'f_who',
    label: 'Booked by',
    type: 'select',
    order: 3,
    options: {
      o_michael: { label: 'Michael', color: '#6366f1' },
      o_jasmine: { label: 'Jasmine', color: '#ec4899' },
      o_nobody: { label: 'Nobody yet', color: '#a3a3a3' },
    },
  },
];

export const CITY_COLORS: Record<string, string> = {
  Tokyo: '#e11d48',
  Kyoto: '#7c3aed',
  Osaka: '#0891b2',
  Hiroshima: '#c2410c',
  'San Francisco': '#0f766e',
  Onomichi: '#a16207',
  Himeji: '#4d7c0f',
};

/** `YYYY-MM-DD HH:MM` in a zone, as an instant. */
function instant(local: string, timeZone: string): number {
  const [day, clock] = local.split(' ');
  const guess = Date.parse(`${day}T${clock}:00Z`);
  const shown = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(guess);

  const part = (type: string) => Number(shown.find((one) => one.type === type)?.value ?? '0');
  const offset =
    Date.UTC(part('year'), part('month') - 1, part('day'), part('hour') % 24, part('minute')) -
    guess;

  return guess - offset;
}

function seed(doc: Doc, entry: Seed, author: Author): Doc {
  const { id, name, at, links, checklist, ...rest } = entry;

  let next = addEvent(doc, { id, name, kind: rest.kind ?? 'activity' }, author);

  const fields: Partial<EditableEventFields> = { ...rest };
  if (at) fields.startsAt = instant(at, rest.timezone ?? HOME_TIMEZONE);
  next = updateEvent(next, id, fields, author);

  links?.forEach(([url, title], index) => {
    next = addLink(next, id, `${id}_l${index}`, { url, title }, author);
  });

  checklist?.forEach(([text, done, deadline], index) => {
    const todoId = `${id}_t${index}`;
    next = addTodo(next, id, todoId, { text, deadline }, author);
    if (done) next = updateTodo(next, id, todoId, { completed: true }, author);
  });

  return next;
}

function build(): Doc {
  let doc = createTrip('japan 2026!', HOME_TIMEZONE);

  doc = updateTripMeta(doc, {
    startsAt: instant(`${TRIP_START} 00:00`, HOME_TIMEZONE),
    endsAt: instant(`${TRIP_END} 23:59`, HOME_TIMEZONE),
  });

  for (const def of FIELD_DEFS) doc = addFieldDef(doc, def);
  for (const [city, color] of Object.entries(CITY_COLORS)) doc = setCityColor(doc, city, color);

  for (const entry of IDEAS) doc = seed(doc, entry, OTHER);
  for (const entry of PLANNED) doc = seed(doc, entry, AUTHOR);

  // A few values filled in, so the custom fields have something to draw and
  // the rest stay empty the way most of them are on a real trip.
  doc = setCustomField(doc, 'e_momijiya', 'f_cost', { kind: 'number', number: 41_000 }, AUTHOR);
  doc = setCustomField(
    doc,
    'e_momijiya',
    'f_who',
    {
      kind: 'options',
      selected: { o_michael: true },
    },
    AUTHOR,
  );
  doc = setCustomField(doc, 'e_arashiyama', 'f_walk', { kind: 'number', number: 12 }, AUTHOR);
  doc = setCustomField(
    doc,
    'e_idea_teamlab',
    'f_needs_booking',
    { kind: 'bool', bool: true },
    OTHER,
  );
  doc = setCustomField(doc, 'e_idea_teamlab', 'f_cost', { kind: 'number', number: 3_800 }, OTHER);

  return doc;
}

let cached: Doc | null = null;

/**
 * The trip, built once per page.
 *
 * Stories that change it start from this and keep their own copy, the way the
 * app holds a document in state — Automerge values are frozen, so nothing a
 * story does can leak into the next one.
 */
export function japanTrip(): Doc {
  cached ??= build();
  return cached;
}

export function japanEvents(): TripEvent[] {
  return liveEvents(japanTrip());
}

export function japanFieldDefs(): FieldDef[] {
  return liveFieldDefs(japanTrip());
}

/** One event by id, for a story that wants to talk about a particular card. */
export function japanEvent(id: string): TripEvent {
  const found = japanTrip().events[id];
  if (!found) throw new Error(`No fixture event ${id}`);
  return found;
}

export function japanDays(): DayKey[] {
  return daysInRange(TRIP_START, TRIP_END);
}

/** Each day of the trip with the zone it is lived in, derived as the app does. */
export function japanSlots(overrides?: Record<string, string>): DaySlot[] {
  return daySlots(japanDays(), japanEvents(), HOME_TIMEZONE, overrides);
}

/*
 * A forecast that never changes, rather than one fetched from a server. Codes
 * are WMO: 0 clear, 2 partly cloudy, 3 overcast, 61 rain, 80 showers.
 */
const FORECAST: Array<[DayKey, number, number, number, string]> = [
  ['2026-05-19', 2, 21, 12, 'Boston'],
  ['2026-05-20', 0, 19, 11, 'San Francisco'],
  ['2026-05-21', 3, 18, 12, 'San Francisco'],
  ['2026-05-22', 2, 24, 17, 'Tokyo'],
  ['2026-05-23', 61, 22, 18, 'Tokyo'],
  ['2026-05-24', 80, 21, 17, 'Tokyo'],
  ['2026-05-25', 3, 23, 17, 'Tokyo'],
  ['2026-05-26', 0, 26, 16, 'Kyoto'],
  ['2026-05-27', 0, 27, 17, 'Kyoto'],
  ['2026-05-28', 2, 26, 18, 'Kyoto'],
  ['2026-05-29', 61, 24, 19, 'Osaka'],
  ['2026-05-30', 2, 25, 18, 'Onomichi'],
  ['2026-05-31', 0, 27, 19, 'Hiroshima'],
  ['2026-06-01', 3, 26, 20, 'Hiroshima'],
  ['2026-06-02', 80, 25, 20, 'Tokyo'],
  ['2026-06-03', 2, 26, 20, 'Tokyo'],
  ['2026-06-04', 0, 27, 20, 'Tokyo'],
  ['2026-06-05', 2, 20, 12, 'San Francisco'],
];

export function japanWeather(): Map<DayKey, DailyWeather> {
  return new Map(
    FORECAST.map(([date, code, max, min, place]) => [date, { date, code, max, min, place }]),
  );
}
