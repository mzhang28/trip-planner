import { normalizeBookingStatus, type TripDoc } from '@trip/crdt';
import { z } from 'zod';

/**
 * What a trip archive is.
 *
 * A zip holding one JSON document and the attachment bytes it points at:
 *
 *   trip.json          the manifest below, with the whole trip inside it
 *   files/<sha256>     one entry per attachment, named by its own hash
 *
 * The document is the trip as it stands rather than its Automerge history.
 * History is only meaningful to the replicas that produced it -- carrying it
 * would make the archive opaque, tie it to an Automerge version, and still not
 * let anyone read the trip without this application. Plain JSON can be opened,
 * checked, and moved somewhere else, which is what an export is for.
 *
 * Files are named by their hash rather than by their filename, so two events
 * attaching the same scan store it once and no archive can contain a name that
 * escapes its own directory. The filenames are in the manifest.
 */
export const MANIFEST_ENTRY = 'trip.json';

export const FILES_PREFIX = 'files/';

/**
 * Written into every archive and checked on the way back in.
 *
 * The version is for readers older than the archive they are handed: a bare
 * "this JSON did not fit the schema" cannot tell someone whether their file is
 * damaged or simply newer than the server they are importing it into.
 */
export const ARCHIVE_FORMAT = 'trip-planner/trip';
export const ARCHIVE_VERSION = 1;

/** Lowercase hex SHA-256, which is both a blob's name and its own checksum. */
export const BLOB_HASH = /^[a-f0-9]{64}$/;

const instant = z.number().int();
const blobHash = z.string().regex(BLOB_HASH);
const eventKind = z.enum(['activity', 'lodging', 'transit', 'note']);
const transitMode = z.enum(['walk', 'transit', 'drive', 'fly']);
const transitMethod = z.enum(['flight', 'train', 'bus', 'car', 'ferry', 'other']);

// An archive written before flights folded into transit carries `kind: 'flight'`
// with a `flight` object, or a transit event with a `mode`. Old archives on disk
// are a real thing someone still has, and they describe a readable trip. Migrate
// each event to the new shape before it is validated, the same fold the document
// normalizer does on read -- done here so the manifest schema stays new-shape.
const LEGACY_MODE_TO_METHOD: Record<string, string> = {
  fly: 'flight',
  drive: 'car',
  transit: 'train',
  walk: 'other',
};

function migrateLegacyEvent(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const event = { ...(raw as Record<string, unknown>) };

  if (event.kind === 'flight') {
    const flight = (event.flight ?? {}) as Record<string, unknown>;
    const transit: Record<string, unknown> = { method: 'flight' };
    const carry: Array<[string, string]> = [
      ['airline', 'operator'],
      ['number', 'number'],
      ['from', 'from'],
      ['to', 'to'],
      ['fromCity', 'fromCity'],
      ['toCity', 'toCity'],
      ['departsTz', 'departsTz'],
      ['arrivesTz', 'arrivesTz'],
      ['seat', 'seat'],
      ['terminal', 'terminal'],
      ['gate', 'gate'],
    ];
    for (const [old, next] of carry) if (flight[old] !== undefined) transit[next] = flight[old];

    event.kind = 'transit';
    event.transit = transit;
    delete event.flight;
  } else if (event.kind === 'transit' && event.transit && typeof event.transit === 'object') {
    const transit = { ...(event.transit as Record<string, unknown>) };
    if (transit.method === undefined) {
      transit.method = LEGACY_MODE_TO_METHOD[transit.mode as string] ?? 'other';
      delete transit.mode;
    }
    event.transit = transit;
  }

  return event;
}

const place = z.object({
  label: z.string(),
  address: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const tripFile = z.object({
  blobHash,
  filename: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  addedAt: instant,
});

const customValue = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('number'), number: z.number() }),
  z.object({ kind: z.literal('instant'), at: instant }),
  z.object({ kind: z.literal('bool'), bool: z.boolean() }),
  z.object({ kind: z.literal('options'), selected: z.record(z.string(), z.literal(true)) }),
]);

const fieldDef = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum([
    'text',
    'longtext',
    'number',
    'money',
    'date',
    'datetime',
    'url',
    'email',
    'phone',
    'checkbox',
    'select',
    'multiselect',
  ]),
  options: z
    .record(z.string(), z.object({ label: z.string(), color: z.string().optional() }))
    .optional(),
  unit: z.string().optional(),
  currency: z.string().optional(),
  // A field that applied to flights now applies to transit. An old archive can
  // name 'flight' here; map it rather than reject the whole trip.
  appliesTo: z
    .array(z.string())
    .transform((kinds) =>
      kinds
        .map((kind) => (kind === 'flight' ? 'transit' : kind))
        .filter((kind): kind is z.infer<typeof eventKind> =>
          (['activity', 'lodging', 'transit', 'note'] as const).includes(
            kind as z.infer<typeof eventKind>,
          ),
        ),
    )
    .optional(),
  order: z.number(),
  deletedAt: instant.optional(),
});

const tripEvent = z.preprocess(
  migrateLegacyEvent,
  z.object({
    id: z.string(),
    kind: eventKind,
    name: z.string(),
    color: z.string().optional(),
    city: z.string().optional(),
    location: place.optional(),
    startsAt: instant.optional(),
    timeUndecided: z.boolean().optional(),
    timezone: z.string().optional(),
    durationMinutes: z.number().optional(),
    transitIn: z
      .object({ minutes: z.number(), mode: transitMode, note: z.string().optional() })
      .optional(),
    booking: z.object({
      /*
       * Taken as any string and mapped, the same as a document arriving from an
       * old replica. An archive written before `in_progress` was removed is a
       * real thing someone may still have on disk, and it describes a trip that
       * is otherwise perfectly readable.
       */
      status: z.unknown().transform(normalizeBookingStatus),
      note: z.string().optional(),
      confirmationCode: z.string().optional(),
    }),
    description: z.string().optional(),
    links: z.record(
      z.string(),
      z.object({ url: z.string(), title: z.string().optional(), addedAt: instant }),
    ),
    attachments: z.record(z.string(), tripFile),
    todos: z
      .record(
        z.string(),
        z.object({
          text: z.string(),
          completed: z.boolean(),
          deadline: z.string().optional(),
          addedAt: instant,
        }),
      )
      .optional(),
    customFields: z.record(z.string(), customValue),
    transit: z
      .object({
        method: transitMethod,
        operator: z.string().optional(),
        number: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        fromCity: z.string().optional(),
        toCity: z.string().optional(),
        departsTz: z.string().optional(),
        arrivesTz: z.string().optional(),
        seat: z.string().optional(),
        terminal: z.string().optional(),
        gate: z.string().optional(),
        platform: z.string().optional(),
        coach: z.string().optional(),
      })
      .optional(),
    lodging: z
      .object({
        checkIn: instant.optional(),
        checkOut: instant.optional(),
        address: z.string().optional(),
      })
      .optional(),
    deletedAt: instant.optional(),
    updatedAt: instant,
    updatedBy: z.string(),
  }),
);

export const tripDocSchema = z.object({
  meta: z.object({
    name: z.string().min(1).max(200),
    startsAt: instant.optional(),
    endsAt: instant.optional(),
    homeTimezone: z.string().min(1),
  }),
  cityColors: z.record(z.string(), z.string()).optional(),
  files: z.record(blobHash, tripFile).optional(),
  fieldDefs: z.record(z.string(), fieldDef),
  events: z.record(z.string(), tripEvent),
});

export const manifestSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.number().int().positive(),
  exportedAt: instant,
  doc: tripDocSchema,
  /**
   * Hashes the exporting server had metadata for but no bytes for. Recorded so
   * an import can say which attachments were already gone rather than blaming
   * the archive for the gap.
   */
  missingFiles: z.array(blobHash).default([]),
});

export type Manifest = z.infer<typeof manifestSchema>;

/*
 * The schema and the document type have to describe the same thing, checked in
 * both directions.
 *
 * Left out one way, a field is silently dropped from every archive; left out
 * the other, a document is accepted with a field nothing else in the app knows
 * how to read. Neither shows up as a test failure -- the export succeeds, and
 * the loss is only visible to whoever goes looking for the field months later.
 * Adding a key to `TripDoc` should stop compiling here until this file has it.
 */
type ParsedDoc = z.infer<typeof tripDocSchema>;
const _schemaCoversDocument: ParsedDoc = null as unknown as TripDoc;
const _documentCoversSchema: TripDoc = null as unknown as ParsedDoc;
void _schemaCoversDocument;
void _documentCoversSchema;
