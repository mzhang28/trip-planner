import {
  BOOKING_STATUS_LABEL,
  liveEvents,
  liveFieldDefs,
  normalizeBookingStatus,
  renderCustomValue,
  stripMentionMarkup,
  type CustomValue,
  type EventKind,
  type FieldDef,
  type TransitMethod,
  type TransitMode,
  type TripDoc,
  type TripEvent,
} from '@trip/crdt';
import {
  dayAfter,
  localDate,
  property,
  readableAt,
  readableDay,
  render,
  textProperty,
  timestamp,
  verbatimProperty,
} from './ics';

/**
 * The trip as a calendar somebody else's client can subscribe to.
 *
 * iCalendar has a property for a handful of the things an event holds — when it
 * is, where it is, whether it is settled — and nothing at all for the rest:
 * a flight number, a seat, a confirmation code, a to-do, a custom field. Those
 * go into the description, which is the one place every client shows verbatim.
 * The alternative was to leave them out, which would make a subscribed
 * itinerary a list of names and times and send everybody back to the app for
 * anything they actually needed at a gate.
 */

/** How often a client is asked to come back for a fresh copy. */
const REFRESH = 'PT1H';

const PRODUCT_ID = '-//Trip Planner//Trip feed//EN';

/**
 * The domain half of every event's UID.
 *
 * Fixed rather than taken from the deployment's own URL. A UID identifies the
 * event to the subscriber for good, and a server that moved to another address
 * would otherwise reissue every event under a new name — which a client reads
 * as the whole trip being deleted and a new one appearing.
 */
const UID_DOMAIN = 'trip-planner';

const KIND_LABEL: Record<EventKind, string> = {
  activity: 'Activity',
  lodging: 'Stay',
  transit: 'Travel',
  note: 'Note',
};

const METHOD_LABEL: Record<TransitMethod, string> = {
  flight: 'Flight',
  train: 'Train',
  bus: 'Bus',
  car: 'Car',
  ferry: 'Ferry',
  other: 'Journey',
};

/** Reads before a number of minutes: "Walk 12 min". */
const MODE_LABEL: Record<TransitMode, string> = {
  walk: 'Walk',
  transit: 'Train or bus',
  drive: 'Drive',
  fly: 'Fly',
};

export interface FeedOptions {
  /** What the calendar calls itself in the subscriber's list. */
  name: string;
  /** Leave out events that are still only ideas. */
  confirmedOnly: boolean;
}

/**
 * Everything the feed says about one trip.
 *
 * The output depends only on the document and the options, with no clock in it
 * anywhere, so the same trip renders byte for byte the same every time. That is
 * what lets the route answer a poll with an ETag and a 304 instead of the whole
 * itinerary.
 */
export function tripCalendar(tripId: string, doc: TripDoc, options: FeedOptions): string {
  const home = doc.meta.homeTimezone || 'UTC';
  const fieldDefs = liveFieldDefs(doc);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    property('PRODID', PRODUCT_ID),
    'CALSCALE:GREGORIAN',
    // Says the calendar is being published for others to read, rather than
    // being an invitation anybody is expected to reply to.
    'METHOD:PUBLISH',
    verbatimProperty('X-WR-CALNAME', options.name),
    /*
     * The zone the calendar is planned in, which is not the same as the zone
     * each event is in. A client that honours it shows the trip on the clock it
     * was planned on even when the phone reading it is somewhere else.
     */
    verbatimProperty('X-WR-TIMEZONE', home),
    property('REFRESH-INTERVAL', REFRESH, { VALUE: 'DURATION' }),
    property('X-PUBLISHED-TTL', REFRESH),
  ];

  for (const event of scheduledEvents(doc, options.confirmedOnly)) {
    lines.push(...calendarEvent(tripId, event, doc, fieldDefs, home));
  }

  lines.push('END:VCALENDAR');

  return render(lines);
}

/**
 * The events worth putting in a calendar, earliest first.
 *
 * An event with no `startsAt` is left out. It is a real part of the plan — "a
 * day trip somewhere, at some point" — but a calendar has nowhere to put a
 * thing with no date, and the clients that accept one at all bury it on the day
 * the file was fetched.
 *
 * Sorted so the document is stable. Nothing downstream depends on the order,
 * but a file that reshuffles itself between two identical requests has a
 * different ETag each time and a subscriber refetches the whole trip for
 * nothing.
 */
function scheduledEvents(doc: TripDoc, confirmedOnly: boolean): TripEvent[] {
  return liveEvents(doc)
    .filter((event) => event.startsAt !== undefined)
    .filter((event) => !confirmedOnly || normalizeBookingStatus(event.booking.status) === 'booked')
    .sort(
      (a, b) => a.startsAt! - b.startsAt! || a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1),
    );
}

/**
 * When an event is over, or null when nothing recorded says.
 *
 * An event with no length gets no end rather than an invented one. The format
 * reads a missing end as an event that occupies no time, which is what "19:00,
 * and we have not decided how long for" amounts to; assuming an hour would put
 * a block on somebody's calendar that nobody planned, over the top of something
 * real.
 *
 * A stay is the exception worth making: a hotel with a check-out recorded has
 * an end, and it is the check-out rather than anything derived.
 */
function endsAt(event: TripEvent): number | null {
  const startsAt = event.startsAt!;

  if (event.durationMinutes !== undefined && event.durationMinutes > 0) {
    return startsAt + event.durationMinutes * 60_000;
  }

  const checkOut = event.lodging?.checkOut;
  return checkOut !== undefined && checkOut > startsAt ? checkOut : null;
}

function calendarEvent(
  tripId: string,
  event: TripEvent,
  doc: TripDoc,
  fieldDefs: FieldDef[],
  home: string,
): string[] {
  const zone = event.timezone ?? home;
  const startsAt = event.startsAt!;

  const lines = [
    'BEGIN:VEVENT',
    // Both halves are needed. Event ids are unique within a trip, and a person
    // subscribed to two trips holds both feeds in one calendar.
    property('UID', `${tripId}-${event.id}@${UID_DOMAIN}`),
    /*
     * When this version of the event was written, which is what a client
     * compares against the copy it already has. `updatedAt` rather than now,
     * so that fetching an unchanged trip twice produces the same document.
     */
    property('DTSTAMP', timestamp(event.updatedAt)),
    property('LAST-MODIFIED', timestamp(event.updatedAt)),
  ];

  if (event.timeUndecided) {
    /*
     * The day is settled and the hour is not, so the event is stored at
     * midnight in its own zone. A timed event at midnight would be a lie about
     * the plan and would land on the wrong day for anyone in another zone; a
     * date-valued event says exactly what is known.
     */
    const day = localDate(startsAt, zone);
    lines.push(property('DTSTART', day, { VALUE: 'DATE' }));
    lines.push(property('DTEND', dayAfter(day), { VALUE: 'DATE' }));
  } else {
    lines.push(property('DTSTART', timestamp(startsAt)));

    const ends = endsAt(event);
    if (ends !== null) lines.push(property('DTEND', timestamp(ends)));
  }

  lines.push(textProperty('SUMMARY', event.name || KIND_LABEL[event.kind]));

  const confirmed = normalizeBookingStatus(event.booking.status) === 'booked';
  lines.push(property('STATUS', confirmed ? 'CONFIRMED' : 'TENTATIVE'));
  /*
   * Whether the event makes you busy. An idea should not: a week of maybes
   * would otherwise black out the calendar and make the trip look impossible to
   * fit anything else around, which is the opposite of what an idea is.
   */
  lines.push(property('TRANSP', confirmed ? 'OPAQUE' : 'TRANSPARENT'));

  const where = placeOf(event);
  if (where) lines.push(textProperty('LOCATION', where));

  const { lat, lng } = event.location ?? {};
  if (lat !== undefined && lng !== undefined) lines.push(property('GEO', `${lat};${lng}`));

  const categories = [KIND_LABEL[event.kind], event.city].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  lines.push(property('CATEGORIES', categories.map(escapeListItem).join(',')));

  // The first link the event carries. Clients turn this into something to tap,
  // which for a booked hotel or a museum ticket is the page you want on arrival.
  const firstLink = Object.values(event.links)[0];
  if (firstLink) lines.push(property('URL', firstLink.url));

  const description = describe(event, doc, fieldDefs, zone);
  if (description) lines.push(textProperty('DESCRIPTION', description));

  lines.push('END:VEVENT');

  return lines;
}

/** A CATEGORIES value is a list, so a comma inside one item has to be escaped. */
function escapeListItem(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/**
 * Where the event is, in one line, as a client hands it to a map.
 *
 * The label and the address together where there are both: the label alone is
 * often a name no map knows, and the address alone loses which of four entrances
 * was meant.
 */
function placeOf(event: TripEvent): string | undefined {
  const { label, address } = event.location ?? {};

  if (label && address) return `${label}, ${address}`;
  if (label ?? address) return label ?? address;

  if (event.lodging?.address) return event.lodging.address;

  const route = transitRoute(event);
  if (route) return route;

  return event.city;
}

function endpoint(code: string | undefined, city: string | undefined): string | undefined {
  if (code && city) return `${city} (${code})`;
  return code ?? city;
}

/** "Tokyo (HND) → San Francisco (SFO)", or as much of it as is known. */
function transitRoute(event: TripEvent): string | undefined {
  const transit = event.transit;
  if (!transit) return undefined;

  const from = endpoint(transit.from, transit.fromCity);
  const to = endpoint(transit.to, transit.toCity);

  if (from && to) return `${from} → ${to}`;
  return from ?? to;
}

/**
 * Everything about the event that no iCalendar property holds.
 *
 * The person's own description comes first and alone, because it is the part
 * they wrote and the part a client truncates last. Everything after it is a
 * labelled line, so the block stays readable in a client that shows the
 * description as one run of text.
 */
function describe(event: TripEvent, doc: TripDoc, fieldDefs: FieldDef[], zone: string): string {
  const startsAt = event.startsAt!;
  const facts: string[] = [];

  const transit = event.transit;

  if (event.timeUndecided) {
    facts.push(`${readableDay(startsAt, zone)} — the hour is not decided yet.`);
  } else if (transit) {
    /*
     * A journey has two clocks and the useful one changes halfway. Both are
     * spelled out because a ticket is written in local time at each end, and a
     * flight that lands the previous afternoon reads as an error otherwise.
     */
    const departsTz = transit.departsTz ?? zone;
    const arrivesTz = transit.arrivesTz ?? departsTz;

    facts.push(`Departs ${readableAt(startsAt, departsTz)} (${departsTz})`);

    const ends = endsAt(event);
    if (ends !== null) facts.push(`Arrives ${readableAt(ends, arrivesTz)} (${arrivesTz})`);
  } else if (event.lodging?.checkIn !== startsAt) {
    /*
     * The times above are all UTC, so a client shows them on the reader's own
     * clock. This is the one that is written on the booking.
     *
     * Skipped for a stay that begins at its own check-in, where the line below
     * already says the same thing in better words.
     */
    facts.push(`Local time ${readableAt(startsAt, zone)} (${zone})`);
  }

  if (transit) {
    const service = [METHOD_LABEL[transit.method], transit.operator, transit.number]
      .filter(Boolean)
      .join(' ');
    const route = transitRoute(event);
    facts.push(route ? `${service}: ${route}` : service);

    const onBoard = [
      transit.seat && `Seat ${transit.seat}`,
      transit.terminal && `Terminal ${transit.terminal}`,
      transit.gate && `Gate ${transit.gate}`,
      transit.platform && `Platform ${transit.platform}`,
      transit.coach && `Coach ${transit.coach}`,
    ].filter(Boolean);

    if (onBoard.length > 0) facts.push(onBoard.join(' · '));
  }

  const lodging = event.lodging;
  if (lodging?.checkIn !== undefined) facts.push(`Check in ${readableAt(lodging.checkIn, zone)}`);
  if (lodging?.checkOut !== undefined)
    facts.push(`Check out ${readableAt(lodging.checkOut, zone)}`);

  facts.push(`Status: ${BOOKING_STATUS_LABEL[normalizeBookingStatus(event.booking.status)]}`);
  if (event.booking.confirmationCode) facts.push(`Confirmation: ${event.booking.confirmationCode}`);
  if (event.booking.note) facts.push(`Booking note: ${event.booking.note}`);

  const leg = event.transitIn;
  if (leg) {
    const note = leg.note ? ` — ${leg.note}` : '';
    facts.push(`Getting here: ${MODE_LABEL[leg.mode]} ${leg.minutes} min${note}`);
  }

  for (const def of fieldDefs) {
    const value = event.customFields[def.id];
    if (value === undefined) continue;

    const rendered = displayValue(value, def);
    if (rendered) facts.push(`${fieldLabel(def)}: ${rendered}`);
  }

  const todos = Object.values(event.todos ?? {});
  for (const todo of todos.sort((a, b) => a.addedAt - b.addedAt)) {
    const deadline = todo.deadline ? ` (by ${todo.deadline})` : '';
    facts.push(`${todo.completed ? '[x]' : '[ ]'} ${todo.text}${deadline}`);
  }

  for (const link of Object.values(event.links)) {
    facts.push(link.title ? `${link.title}: ${link.url}` : link.url);
  }

  const attachments = Object.values(event.attachments).map((file) => file.filename);
  if (attachments.length > 0) facts.push(`Attached in the app: ${attachments.join(', ')}`);

  const own = event.description ? stripMentionMarkup(event.description).trim() : '';

  return [own, facts.join('\n')].filter(Boolean).join('\n\n');
}

/** A money field says its currency in the label, the same as the app's form. */
function fieldLabel(def: FieldDef): string {
  return def.type === 'money' && def.currency ? `${def.label} (${def.currency})` : def.label;
}

/**
 * A custom field value as a reader wants it.
 *
 * `renderCustomValue` exists to be searched rather than read: it writes a date
 * twice, once machine-readable and once not, so that either form finds the
 * event. That is right for an index and wrong in a sentence, so a date is
 * rendered here and everything else is handed over.
 */
function displayValue(value: CustomValue, def: FieldDef): string {
  if (value.kind !== 'instant') return renderCustomValue(value, def);

  const at = new Date(value.at);
  if (Number.isNaN(at.getTime())) return '';

  return def.type === 'date' ? readableDay(value.at, 'UTC') : readableAt(value.at, 'UTC');
}
