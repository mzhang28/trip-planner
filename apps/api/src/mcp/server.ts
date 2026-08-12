import * as A from '@automerge/automerge';
import {
  BOOKING_STATUS_LABEL,
  addEvent,
  addLink,
  deleteEvent,
  eventSearchText,
  liveEvents,
  liveFieldDefs,
  normalizeBookingStatus,
  updateEvent,
  type TripDoc,
  type TripEvent,
  type TripFile,
} from '@trip/crdt';
import { auditLog, events, tripMembers, trips } from '@trip/schema';
import { and, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import type { Services } from '../context';
import { fileLink } from '../fileLinks';
import { canEdit, token } from '../identity';
import type { AccessContext } from '../routes/oauth';

/**
 * Times are epoch milliseconds, and an ISO string with an offset is also
 * accepted. A model writing `2026-08-14T09:00:00+09:00` is far more likely to
 * be right than one doing epoch arithmetic in its head, and refusing the form
 * it reaches for first turns one call into three.
 */
const instant = z.union([z.number().int(), z.string()]).transform((value, ctx) => {
  if (typeof value === 'number') return value;

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    ctx.addIssue({ code: 'custom', message: `not a time: ${value}` });
    return z.NEVER;
  }
  return parsed;
});

export interface ToolContext {
  services: Services;
  access: AccessContext;
}

/** Refuses a trip the token was not granted, whatever the person can reach. */
function authorize(ctx: ToolContext, tripId: string, write: boolean) {
  if (!ctx.access.grantedTripIds.includes(tripId)) {
    throw new Error(`This client was not granted access to ${tripId}`);
  }

  const membership = ctx.services.db
    .select({ role: tripMembers.role })
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.userId, ctx.access.userId)))
    .get();

  if (!membership) throw new Error('You are not on that trip');

  if (write) {
    if (!ctx.access.scope.includes('trips:write')) throw new Error('This grant is read-only');
    if (!canEdit(membership.role)) throw new Error('You can only read that trip');
  }

  return membership.role;
}

/**
 * A file as an agent can use it: what it is, and where to go and read it.
 *
 * The address is signed and absolute. Whatever follows it holds no session,
 * so a path into `/api` would only ever answer it with a refusal.
 */
function describeFile(ctx: ToolContext, file: TripFile): Record<string, unknown> {
  return {
    filename: file.filename,
    mime: file.mime,
    size: file.size,
    url: fileLink(ctx.services.db, file.blobHash, file.mime),
  };
}

function summarise(ctx: ToolContext, event: TripEvent): Record<string, unknown> {
  const bookingStatus = normalizeBookingStatus(event.booking.status);

  return {
    id: event.id,
    kind: event.kind,
    name: event.name,
    city: event.city,
    place: event.location?.label,
    startsAt: event.startsAt,
    timezone: event.timezone,
    durationMinutes: event.durationMinutes,
    flight: event.flight,
    transit: event.transit,
    booking: {
      ...event.booking,
      status: bookingStatus === 'booked' ? 'confirmed' : 'flexible',
    },
    links: Object.values(event.links).map((link) => ({ url: link.url, title: link.title })),
    files: Object.values(event.attachments).map((file) => describeFile(ctx, file)),
  };
}

/** Writes an audit row, capturing what the affected fields were beforehand. */
function record(
  ctx: ToolContext,
  tripId: string,
  toolName: string,
  args: unknown,
  before: unknown,
  summary: string,
): void {
  ctx.services.db
    .insert(auditLog)
    .values({
      id: `al_${token(12)}`,
      tripId,
      actorUserId: ctx.access.userId,
      source: 'mcp',
      clientId: ctx.access.clientId,
      toolName,
      argsJson: JSON.stringify(args ?? {}),
      beforeJson: before === undefined ? null : JSON.stringify(before),
      summary,
      createdAt: Date.now(),
    })
    .run();
}

function withDoc(ctx: ToolContext, tripId: string, mutate: (doc: TripDoc) => TripDoc) {
  const { docs } = ctx.services;
  const current = docs.load(tripId);
  if (!current) throw new Error('No such trip');

  const next = mutate(current as TripDoc);
  docs.commit(tripId, next as never, A.getChanges(current, next as never), ctx.access.userId);
}

export const TOOL_DEFINITIONS = [
  { name: 'list_trips', description: 'Trips this client was granted.' },
  { name: 'list_events', description: 'Events on a trip, earliest first.' },
  { name: 'get_event', description: 'Everything about one event.' },
  { name: 'search_events', description: 'Find events by any of their text, including custom fields.' },
  { name: 'create_event', description: 'Add an event. Only a name is required.' },
  { name: 'update_event', description: 'Change fields on an event.' },
  { name: 'delete_event', description: 'Remove an event.' },
  { name: 'set_booking_status', description: 'Mark an event as flexible or confirmed.' },
  { name: 'add_link', description: 'Attach a web address to an event.' },
  { name: 'list_field_defs', description: "The trip's custom fields." },
  {
    name: 'list_files',
    description:
      "Files on a trip: tickets, confirmations, scans. Each carries a link you can fetch to read it.",
  },
] as const;

export const toolSchemas = {
  list_trips: z.object({}),
  list_events: z.object({ tripId: z.string(), from: instant.optional(), to: instant.optional() }),
  get_event: z.object({ tripId: z.string(), eventId: z.string() }),
  search_events: z.object({ tripId: z.string(), query: z.string().min(1) }),
  create_event: z.object({
    tripId: z.string(),
    name: z.string().min(1),
    kind: z.enum(['activity', 'lodging', 'flight', 'transit', 'note']).optional(),
    city: z.string().optional(),
    startsAt: instant.optional(),
    timezone: z.string().optional(),
  }),
  update_event: z.object({
    tripId: z.string(),
    eventId: z.string(),
    name: z.string().optional(),
    city: z.string().optional(),
    startsAt: instant.optional(),
    timezone: z.string().optional(),
    durationMinutes: z.number().int().positive().optional(),
  }),
  delete_event: z.object({ tripId: z.string(), eventId: z.string() }),
  set_booking_status: z.object({
    tripId: z.string(),
    eventId: z.string(),
    status: z.enum(['flexible', 'confirmed']),
    note: z.string().optional(),
  }),
  add_link: z.object({
    tripId: z.string(),
    eventId: z.string(),
    url: z.string().url(),
    title: z.string().optional(),
  }),
  list_field_defs: z.object({ tripId: z.string() }),
  list_files: z.object({ tripId: z.string() }),
} as const;

export type ToolName = keyof typeof toolSchemas;

export async function runTool(ctx: ToolContext, name: ToolName, rawArgs: unknown): Promise<unknown> {
  const args = toolSchemas[name].parse(rawArgs ?? {});
  const { db, docs } = ctx.services;

  switch (name) {
    case 'list_trips': {
      const rows = db
        .select({ id: trips.id, name: trips.name, homeTimezone: trips.homeTimezone })
        .from(trips)
        .all()
        .filter((trip) => ctx.access.grantedTripIds.includes(trip.id));

      return { trips: rows };
    }

    case 'list_events': {
      const a = args as z.infer<typeof toolSchemas.list_events>;
      authorize(ctx, a.tripId, false);

      const doc = docs.load(a.tripId) as TripDoc | null;
      const all = liveEvents(doc ?? undefined)
        .filter((event) => {
          if (a.from !== undefined && (event.startsAt ?? Infinity) < a.from) return false;
          if (a.to !== undefined && (event.startsAt ?? -Infinity) > a.to) return false;
          return true;
        })
        .sort((x, y) => (x.startsAt ?? Infinity) - (y.startsAt ?? Infinity));

      return { events: all.map((event) => summarise(ctx, event)) };
    }

    case 'get_event': {
      const a = args as z.infer<typeof toolSchemas.get_event>;
      authorize(ctx, a.tripId, false);

      const doc = docs.load(a.tripId) as TripDoc | null;
      const event = doc?.events[a.eventId];
      if (!event || event.deletedAt !== undefined) throw new Error('No such event');

      return { event: { ...summarise(ctx, event), customFields: event.customFields } };
    }

    case 'search_events': {
      const a = args as z.infer<typeof toolSchemas.search_events>;
      authorize(ctx, a.tripId, false);

      /*
       * Answered from the projection rather than the document. It is the same
       * text the browser searches, built by the same function, so a field is
       * findable here or in the app but never in only one of them.
       */
      const rows = db
        .select({ id: events.id, name: events.name, city: events.city, startsAt: events.startsAt })
        .from(events)
        .where(and(eq(events.tripId, a.tripId), like(events.searchText, `%${a.query}%`)))
        .all();

      return { events: rows };
    }

    case 'create_event': {
      const a = args as z.infer<typeof toolSchemas.create_event>;
      authorize(ctx, a.tripId, true);

      const eventId = `e_${token(12)}`;
      withDoc(ctx, a.tripId, (doc) => {
        let next = addEvent(doc as never, { id: eventId, name: a.name, kind: a.kind }, {
          userId: ctx.access.userId,
        });
        if (a.city || a.startsAt !== undefined || a.timezone) {
          next = updateEvent(
            next,
            eventId,
            { city: a.city, startsAt: a.startsAt, timezone: a.timezone },
            { userId: ctx.access.userId },
          );
        }
        return next as never;
      });

      // No `before`: undoing a creation is removing it, and there was nothing
      // to put back.
      record(ctx, a.tripId, name, a, undefined, `Added “${a.name}”`);
      return { eventId };
    }

    case 'update_event': {
      const a = args as z.infer<typeof toolSchemas.update_event>;
      authorize(ctx, a.tripId, true);

      const doc = docs.load(a.tripId) as TripDoc | null;
      const existing = doc?.events[a.eventId];
      if (!existing) throw new Error('No such event');

      /*
       * Only the keys the caller actually sent.
       *
       * `updateEvent` reads an undefined value as "clear this field", which is
       * what the editor needs for emptying a box. Passing the whole set with
       * most of them undefined would therefore erase everything the caller did
       * not mention -- changing a city would take the name with it.
       */
      const patch: Record<string, unknown> = {};
      for (const key of ['name', 'city', 'startsAt', 'timezone', 'durationMinutes'] as const) {
        if (a[key] !== undefined) patch[key] = a[key];
      }

      if (Object.keys(patch).length === 0) return { ok: true, changed: 0 };

      // Only the fields being touched are captured, so undo puts those back
      // without reverting anything somebody else changed in the meantime.
      const before = Object.fromEntries(
        Object.keys(patch).map((key) => [
          key,
          (existing as unknown as Record<string, unknown>)[key],
        ]),
      );

      withDoc(ctx, a.tripId, (d) =>
        updateEvent(d as never, a.eventId, patch, { userId: ctx.access.userId }) as never,
      );

      record(ctx, a.tripId, name, a, before, `Changed “${existing.name}”`);
      return { ok: true };
    }

    case 'delete_event': {
      const a = args as z.infer<typeof toolSchemas.delete_event>;
      authorize(ctx, a.tripId, true);

      const doc = docs.load(a.tripId) as TripDoc | null;
      const existing = doc?.events[a.eventId];
      if (!existing) throw new Error('No such event');

      withDoc(ctx, a.tripId, (d) =>
        deleteEvent(d as never, a.eventId, { userId: ctx.access.userId }) as never,
      );

      record(ctx, a.tripId, name, a, { deletedAt: undefined }, `Deleted “${existing.name}”`);
      return { ok: true };
    }

    case 'set_booking_status': {
      const a = args as z.infer<typeof toolSchemas.set_booking_status>;
      authorize(ctx, a.tripId, true);

      const doc = docs.load(a.tripId) as TripDoc | null;
      const existing = doc?.events[a.eventId];
      if (!existing) throw new Error('No such event');

      const before = { booking: { ...existing.booking } };
      const status = a.status === 'confirmed' ? 'booked' : 'idea';

      withDoc(ctx, a.tripId, (d) =>
        updateEvent(
          d as never,
          a.eventId,
          { booking: { ...existing.booking, status, note: a.note } },
          { userId: ctx.access.userId },
        ) as never,
      );

      record(
        ctx,
        a.tripId,
        name,
        a,
        before,
        `Marked “${existing.name}” as ${BOOKING_STATUS_LABEL[status]}`,
      );
      return { ok: true };
    }

    case 'add_link': {
      const a = args as z.infer<typeof toolSchemas.add_link>;
      authorize(ctx, a.tripId, true);

      const linkId = `l_${token(12)}`;
      withDoc(ctx, a.tripId, (d) =>
        addLink(d as never, a.eventId, linkId, { url: a.url, title: a.title }, {
          userId: ctx.access.userId,
        }) as never,
      );

      record(ctx, a.tripId, name, a, undefined, `Added a link`);
      return { linkId };
    }

    case 'list_field_defs': {
      const a = args as z.infer<typeof toolSchemas.list_field_defs>;
      authorize(ctx, a.tripId, false);

      const doc = docs.load(a.tripId) as TripDoc | null;
      return { fields: liveFieldDefs(doc ?? undefined) };
    }

    case 'list_files': {
      const a = args as z.infer<typeof toolSchemas.list_files>;
      authorize(ctx, a.tripId, false);

      const doc = docs.load(a.tripId) as TripDoc | null;

      /*
       * The library and the attachments together, keyed by hash so a file on
       * three events is one entry. A document made before the library existed
       * has nothing in `files` and everything on its events, so reading only
       * one of the two would show an older trip as having no files at all.
       */
      const found = new Map<string, { file: TripFile; onEvents: string[] }>();

      for (const [hash, file] of Object.entries(doc?.files ?? {})) {
        found.set(hash, { file, onEvents: [] });
      }

      for (const event of liveEvents(doc ?? undefined)) {
        for (const attachment of Object.values(event.attachments)) {
          const seen = found.get(attachment.blobHash);
          if (seen) seen.onEvents.push(event.name);
          else found.set(attachment.blobHash, { file: attachment, onEvents: [event.name] });
        }
      }

      return {
        files: [...found.values()].map(({ file, onEvents }) => ({
          ...describeFile(ctx, file),
          onEvents,
        })),
      };
    }
  }
}

/**
 * An instant written in the zone it happens in, as ISO 8601 with the offset.
 *
 * The offset is carried rather than implied. `2026-08-14T19:00:00+09:00` says
 * both the wall clock the traveller reads and the moment it names, and it is
 * the same form the tools above accept, so what a model reads here it can hand
 * straight back without converting anything.
 */
function isoInZone(at: number, timeZone: string): string {
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    }).formatToParts(at);
  } catch {
    // Nothing validates the zone on the way in, so an event can carry a name
    // no calendar knows. UTC at least names the right moment.
    return new Date(at).toISOString().replace(/\.\d+Z$/, '+00:00');
  }

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';

  // "GMT+09:00" for a zone with an offset, and a bare "GMT" at zero.
  const offset = value('timeZoneName').replace('GMT', '') || '+00:00';

  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}${offset}`;
}

/**
 * The trip as markdown, which is what an agent is usually asked to produce.
 *
 * Days are the ones the traveller is living through, so an event is filed under
 * its own zone rather than under UTC. A dinner at seven in Tokyo belongs to that
 * evening; read in UTC it moves to ten in the morning and, often enough, to the
 * day before.
 */
export function renderItinerary(doc: TripDoc, tripName: string, homeTimezone: string): string {
  const byDay = new Map<string, TripEvent[]>();
  const zoneOf = (event: TripEvent) => event.timezone || homeTimezone;

  for (const event of liveEvents(doc)) {
    const day =
      event.startsAt === undefined
        ? 'Not scheduled'
        : isoInZone(event.startsAt, zoneOf(event)).slice(0, 10);

    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }

  const lines = [`# ${tripName}`, ''];

  for (const [day, dayEvents] of [...byDay.entries()].sort()) {
    lines.push(`## ${day}`, '');
    for (const event of dayEvents.sort((a, b) => (a.startsAt ?? 0) - (b.startsAt ?? 0))) {
      const time =
        event.startsAt === undefined
          ? 'No time yet'
          : isoInZone(event.startsAt, zoneOf(event));

      const status = normalizeBookingStatus(event.booking.status);
      lines.push(`- **${time}** ${event.name} — ${BOOKING_STATUS_LABEL[status]}`);
      if (event.location?.label) lines.push(`  - ${event.location.label}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export { eventSearchText };
