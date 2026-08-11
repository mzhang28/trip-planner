import type { BookingStatus, EventKind } from '@trip/crdt';
import { blob, index, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';
import { trips } from './identity';

/**
 * The compacted Automerge document for a trip.
 *
 * Rewritten whenever accumulated changes are folded back in, which is what
 * keeps history from growing without bound.
 */
export const tripDocs = sqliteTable('trip_docs', {
  tripId: text('trip_id')
    .primaryKey()
    .references(() => trips.id, { onDelete: 'cascade' }),
  /** The output of Automerge.save(). */
  snapshot: blob('snapshot', { mode: 'buffer' }).notNull(),
  /** The heads at the time of saving, as a JSON array of hashes. */
  heads: text('heads').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/**
 * Individual changes as they arrive, appended between compactions.
 *
 * A client that has been away for an hour can be caught up from these without
 * the server loading and re-sending the whole document.
 */
export const tripChanges = sqliteTable(
  'trip_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    /** Automerge's hash for the change. Makes re-delivery a no-op. */
    hash: text('hash').notNull(),
    actorId: text('actor_id').notNull(),
    change: blob('change', { mode: 'buffer' }).notNull(),
    receivedAt: integer('received_at').notNull(),
  },
  (table) => [
    unique('trip_changes_hash').on(table.tripId, table.hash),
    index('trip_changes_trip').on(table.tripId, table.id),
  ],
);

/*
 * Everything below is a projection of the document above.
 *
 * It exists so the MCP tools, full-text search, and the audit log can use SQL
 * instead of loading and walking an Automerge document. It is derived state:
 * no request handler writes to it directly, it is rebuilt from trip_docs after
 * every sync, and it can be thrown away and regenerated at any time.
 */

export const events = sqliteTable(
  'events',
  {
    tripId: text('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    id: text('id').primaryKey(),
    kind: text('kind').notNull().$type<EventKind>(),
    name: text('name').notNull(),
    city: text('city'),
    locationLabel: text('location_label'),
    locationAddress: text('location_address'),
    lat: real('lat'),
    lng: real('lng'),
    startsAt: integer('starts_at'),
    timezone: text('timezone'),
    durationMinutes: integer('duration_minutes'),
    bookingStatus: text('booking_status').notNull().$type<BookingStatus>(),
    bookingNote: text('booking_note'),
    confirmationCode: text('confirmation_code'),
    description: text('description'),
    /** The output of eventSearchText, which is what FTS5 indexes. */
    searchText: text('search_text').notNull(),
    deletedAt: integer('deleted_at'),
    updatedAt: integer('updated_at').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    index('events_trip_start').on(table.tripId, table.startsAt),
    index('events_trip_city').on(table.tripId, table.city),
  ],
);

export const eventLinks = sqliteTable(
  'event_links',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title'),
    addedAt: integer('added_at').notNull(),
  },
  (table) => [index('event_links_event').on(table.eventId)],
);

export const eventCustomFields = sqliteTable(
  'event_custom_fields',
  {
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    fieldDefId: text('field_def_id').notNull(),
    /** The rendered form, which is what search matches against. */
    valueText: text('value_text').notNull(),
  },
  (table) => [index('event_custom_fields_event').on(table.eventId)],
);
