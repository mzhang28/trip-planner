import * as A from '@automerge/automerge';
import { higherStatus, normalizeBookingStatus } from './status';
import type {
  AttachmentId,
  Booking,
  CustomValue,
  EventAttachment,
  EventId,
  EventKind,
  EventTodo,
  FieldDef,
  FieldDefId,
  FieldOption,
  Instant,
  LinkId,
  OptionId,
  TransitMethod,
  TransitMode,
  TripDoc,
  TripEvent,
  TripFile,
  TripMeta,
  TodoId,
  UserId,
} from './types';

export type Doc = A.Doc<TripDoc>;

/** Who is making a change, and when. Every mutation records both. */
export interface Author {
  userId: UserId;
  now?: Instant;
}

function stamp(event: TripEvent, author: Author): void {
  event.updatedAt = author.now ?? Date.now();
  event.updatedBy = author.userId;
}

export function createTrip(name: string, homeTimezone: string): Doc {
  return A.from<TripDoc>({
    // `dayZones` is created here rather than on first use. Two people fixing
    // different days at once would otherwise each make a map of their own, and
    // merging two maps keeps one -- taking the other's correction with it.
    meta: { name, homeTimezone, dayZones: {} },
    files: {},
    fieldDefs: {},
    events: {},
  });
}

/**
 * Rewrites the removed `in_progress` value from older replicas as Flexible.
 * Keeping this as an Automerge change lets the correction sync back to every
 * device instead of making each interface hide the stale value independently.
 */
export function normalizeBookingStatuses(doc: Doc): Doc {
  return A.change(doc, (d) => {
    for (const event of Object.values(d.events ?? {})) {
      const normalized = normalizeBookingStatus(event.booking.status);
      if (event.booking.status !== normalized) event.booking.status = normalized;
    }
  });
}

// The mode an older transit event carried maps to the closest method. 'transit'
// was labelled "Train / bus", so it becomes a train; a walk is not really a way
// to travel between cities, so it falls to 'other'.
const MODE_TO_METHOD: Record<TransitMode, TransitMethod> = {
  fly: 'flight',
  drive: 'car',
  transit: 'train',
  walk: 'other',
};

/**
 * Folds the retired `flight` kind into `transit`, and gives an older transit
 * event a `method` in place of its `mode`.
 *
 * A flight becomes a transit event whose method is 'flight', carrying the same
 * airline, seats, and airports under their new names. Like the booking-status
 * pass, this is an Automerge change so the correction syncs back to every
 * device rather than each interface hiding the old shape on its own. An event
 * already in the new shape is left untouched, so on a migrated document the
 * change is empty and nothing is written.
 */
export function normalizeEventKinds(doc: Doc): Doc {
  return A.change(doc, (d) => {
    for (const event of Object.values(d.events ?? {})) {
      const e = event as unknown as Record<string, unknown>;

      if (e.kind === 'flight') {
        const f = (e.flight ?? {}) as Record<string, string | undefined>;
        const transit: Record<string, unknown> = { method: 'flight' };
        // airline is the only field that changed name; the rest keep theirs.
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
        for (const [old, next] of carry) {
          if (f[old] !== undefined) transit[next] = f[old];
        }

        e.kind = 'transit';
        e.transit = transit;
        delete e.flight;
      } else if (e.kind === 'transit' && e.transit) {
        const t = e.transit as Record<string, unknown>;
        if (t.method === undefined) {
          t.method = MODE_TO_METHOD[t.mode as TransitMode] ?? 'other';
          delete t.mode;
        }
      }
    }
  });
}

/**
 * Changes trip-wide facts as one mergeable document edit.
 *
 * Optional values are deleted instead of assigned `undefined`, which Automerge
 * does not accept. Writing each key separately also lets two people change the
 * start and end dates at the same time without replacing the whole metadata
 * object.
 */
export function updateTripMeta(doc: Doc, patch: Partial<TripMeta>): Doc {
  return A.change(doc, (d) => {
    if ('name' in patch && patch.name !== undefined) d.meta.name = patch.name;
    if ('homeTimezone' in patch && patch.homeTimezone !== undefined) {
      d.meta.homeTimezone = patch.homeTimezone;
    }

    for (const key of ['startsAt', 'endsAt'] as const) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (value === undefined) delete d.meta[key];
      else d.meta[key] = value;
    }
  });
}

/**
 * Fixes a day to a zone, or lets it go back to being worked out.
 *
 * Keyed by day rather than held as a run, so two people correcting different
 * days both keep their correction: a run would be one value, and the later
 * write would take the other's day with it.
 */
export function setDayZone(doc: Doc, day: string, timezone: string | undefined): Doc {
  return A.change(doc, (d) => {
    if (timezone === undefined) {
      if (d.meta.dayZones) delete d.meta.dayZones[day];
      return;
    }

    // Older documents predate the map. One made here can still be lost to a
    // concurrent one, which costs a correction rather than anything of the
    // trip; documents made since carry it from the start.
    d.meta.dayZones ??= {};
    d.meta.dayZones[day] = timezone;
  });
}

/** Assigns one shared colour to a city everywhere it appears in a trip. */
export function setCityColor(doc: Doc, city: string, color: string | undefined): Doc {
  return A.change(doc, (d) => {
    const key = city.trim();
    if (!key) return;

    if (color === undefined) {
      if (d.cityColors) delete d.cityColors[key];
      return;
    }

    d.cityColors ??= {};
    d.cityColors[key] = color;
  });
}

export interface NewEvent {
  id: EventId;
  name: string;
  kind?: EventKind;
}

/**
 * Creates an event with nothing but a name.
 *
 * Everything else is optional by design: someone remembering a place over
 * dinner should be able to get it down before they lose it, and fill in when
 * and whether it is confirmed once they know.
 */
export function addEvent(doc: Doc, event: NewEvent, author: Author): Doc {
  return A.change(doc, (d) => {
    d.events[event.id] = {
      id: event.id,
      kind: event.kind ?? 'activity',
      name: event.name,
      booking: { status: 'idea' },
      links: {},
      attachments: {},
      todos: {},
      customFields: {},
      updatedAt: author.now ?? Date.now(),
      updatedBy: author.userId,
    };
  });
}

/**
 * The fields a caller may set directly.
 *
 * `links`, `attachments`, and `customFields` are left out because they are
 * keyed collections whose merge behaviour depends on being edited key by key —
 * replacing the whole map would turn two people's concurrent additions into one
 * person's map winning. They have their own functions below.
 */
export type EditableEventFields = Omit<
  TripEvent,
  'id' | 'links' | 'attachments' | 'customFields' | 'updatedAt' | 'updatedBy' | 'deletedAt'
>;

/**
 * A value Automerge will take.
 *
 * Automerge rejects `undefined` outright, and a patch is often built by
 * spreading what is already there -- `{ ...flight, number: undefined }` to
 * clear one field, or a place with no street address. One such key threw, and
 * the whole change was lost: the pin chosen from the map never arrived, and
 * nothing on screen said why. A key with no value is the same as an absent
 * key here, so it is dropped.
 */
function withoutBlanks(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;

  const kept: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (inner !== undefined) kept[key] = withoutBlanks(inner);
  }

  return kept;
}

export function updateEvent(
  doc: Doc,
  id: EventId,
  patch: Partial<EditableEventFields>,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[id];
    if (!event) return;

    /*
     * Written key by key rather than as one object assignment, so that a patch
     * touching only the city produces a change touching only the city. Merging
     * is per key: replacing the whole event would make two people editing
     * different fields into a conflict where one loses.
     *
     * The cast is safe because `patch` is typed at every call site; it is only
     * needed because iterating Object.entries loses that.
     */
    const target = event as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        delete target[key];
      } else {
        target[key] = withoutBlanks(value);
      }
    }

    stamp(event, author);
  });
}

/**
 * Marks an event deleted without removing it.
 *
 * The marker is what tells a peer that was offline during the delete that the
 * event went away, rather than letting it merge the event back in. Removing the
 * key outright is the sweep's job, thirty days later.
 */
export function deleteEvent(doc: Doc, id: EventId, author: Author): Doc {
  return A.change(doc, (d) => {
    const event = d.events[id];
    if (!event || event.deletedAt !== undefined) return;

    event.deletedAt = author.now ?? Date.now();
    stamp(event, author);
  });
}

export function restoreEvent(doc: Doc, id: EventId, author: Author): Doc {
  return A.change(doc, (d) => {
    const event = d.events[id];
    if (!event) return;

    delete event.deletedAt;
    stamp(event, author);
  });
}

export function addLink(
  doc: Doc,
  eventId: EventId,
  linkId: LinkId,
  link: { url: string; title?: string },
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    event.links[linkId] = {
      url: link.url,
      ...(link.title === undefined ? {} : { title: link.title }),
      addedAt: author.now ?? Date.now(),
    };
    stamp(event, author);
  });
}

export function removeLink(doc: Doc, eventId: EventId, linkId: LinkId, author: Author): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    delete event.links[linkId];
    stamp(event, author);
  });
}

export function addAttachment(
  doc: Doc,
  eventId: EventId,
  attachmentId: AttachmentId,
  attachment: EventAttachment,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    d.files ??= {};
    if (d.files[attachment.blobHash] === undefined) {
      d.files[attachment.blobHash] = {
        blobHash: attachment.blobHash,
        filename: attachment.filename,
        mime: attachment.mime,
        size: attachment.size,
        addedAt: attachment.addedAt,
      };
    }
    // `attachment` can be an Automerge proxy when it came from the trip file
    // library. A document object cannot be inserted at a second path, so each
    // attachment gets a new plain object containing the same blob reference.
    event.attachments[attachmentId] = {
      blobHash: attachment.blobHash,
      filename: attachment.filename,
      mime: attachment.mime,
      size: attachment.size,
      addedAt: attachment.addedAt,
    };
    stamp(event, author);
  });
}

/** Adds an upload to the trip library without requiring an event attachment. */
export function addTripFile(doc: Doc, file: TripFile): Doc {
  return A.change(doc, (d) => {
    d.files ??= {};
    d.files[file.blobHash] = {
      blobHash: file.blobHash,
      filename: file.filename,
      mime: file.mime,
      size: file.size,
      addedAt: file.addedAt,
    };
  });
}

/**
 * Returns every reusable file, including attachments from older documents.
 * Library metadata wins when the same bytes already have a library entry.
 */
export function tripFiles(doc: TripDoc | undefined): TripFile[] {
  const files = new Map<string, TripFile>();

  for (const event of Object.values(doc?.events ?? {})) {
    for (const attachment of Object.values(event.attachments ?? {})) {
      files.set(attachment.blobHash, attachment);
    }
  }

  for (const file of Object.values(doc?.files ?? {})) files.set(file.blobHash, file);

  return [...files.values()];
}

/**
 * Drops the reference, leaving the bytes alone.
 *
 * The same file may be on another event, and the name is the content, so the
 * blob is shared. Removing the bytes is the sweep's job once nothing points at
 * them any more.
 */
export function removeAttachment(
  doc: Doc,
  eventId: EventId,
  attachmentId: AttachmentId,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    delete event.attachments[attachmentId];
    stamp(event, author);
  });
}

export function addTodo(
  doc: Doc,
  eventId: EventId,
  todoId: TodoId,
  todo: Pick<EventTodo, 'text' | 'deadline'>,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    event.todos ??= {};
    event.todos[todoId] = {
      text: todo.text,
      completed: false,
      ...(todo.deadline === undefined ? {} : { deadline: todo.deadline }),
      addedAt: author.now ?? Date.now(),
    };
    stamp(event, author);
  });
}

export type EditableTodo = Pick<EventTodo, 'text' | 'completed' | 'deadline'>;

/** Updates todo fields one by one so concurrent edits to different fields merge. */
export function updateTodo(
  doc: Doc,
  eventId: EventId,
  todoId: TodoId,
  patch: Partial<EditableTodo>,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    const todo = event?.todos?.[todoId];
    if (!event || !todo) return;

    if (patch.text !== undefined) todo.text = patch.text;
    if (patch.completed !== undefined) todo.completed = patch.completed;
    if ('deadline' in patch) {
      if (patch.deadline === undefined) delete todo.deadline;
      else todo.deadline = patch.deadline;
    }
    stamp(event, author);
  });
}

export function removeTodo(
  doc: Doc,
  eventId: EventId,
  todoId: TodoId,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event?.todos) return;

    delete event.todos[todoId];
    stamp(event, author);
  });
}

/** Every blob hash the trip still points at, for deciding what may be deleted. */
export function referencedBlobs(doc: TripDoc | undefined): Set<string> {
  const hashes = new Set<string>(Object.keys(doc?.files ?? {}));

  // Includes tombstoned events on purpose: a deleted event can be undone, and
  // its files have to still be there when it is.
  for (const event of Object.values(doc?.events ?? {})) {
    for (const attachment of Object.values(event.attachments)) {
      hashes.add(attachment.blobHash);
    }
  }

  return hashes;
}

export function setCustomField(
  doc: Doc,
  eventId: EventId,
  fieldId: FieldDefId,
  value: CustomValue | undefined,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    if (value === undefined) {
      delete event.customFields[fieldId];
    } else {
      event.customFields[fieldId] = value;
    }
    stamp(event, author);
  });
}

export function addFieldDef(doc: Doc, def: FieldDef): Doc {
  return A.change(doc, (d) => {
    d.fieldDefs[def.id] = def;
  });
}

/** What a caller may change about a field definition after it exists. */
export type EditableFieldDef = Pick<FieldDef, 'label' | 'type' | 'unit' | 'currency' | 'order'>;

export function updateFieldDef(
  doc: Doc,
  id: FieldDefId,
  patch: Partial<EditableFieldDef>,
): Doc {
  return A.change(doc, (d) => {
    const def = d.fieldDefs[id];
    if (!def) return;

    const target = def as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete target[key];
      else target[key] = value;
    }
  });
}

export function addFieldOption(
  doc: Doc,
  fieldId: FieldDefId,
  optionId: OptionId,
  option: FieldOption,
): Doc {
  return A.change(doc, (d) => {
    const def = d.fieldDefs[fieldId];
    if (!def) return;

    // Created lazily: a field only becomes a choice field when it has choices,
    // and retyping one to text should not leave an empty options map behind.
    def.options ??= {};
    def.options[optionId] = option;
  });
}

/** Changes one property without replacing the rest of a synced choice. */
export function updateFieldOption(
  doc: Doc,
  fieldId: FieldDefId,
  optionId: OptionId,
  patch: Partial<FieldOption>,
): Doc {
  return A.change(doc, (d) => {
    const option = d.fieldDefs[fieldId]?.options?.[optionId];
    if (!option) return;

    const target = option as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete target[key];
      else target[key] = value;
    }
  });
}

/**
 * Removes an option from a choice field, and from every event that had it
 * ticked.
 *
 * Leaving the ticks behind would show a count that does not match what is
 * listed, since a tick with no option renders as nothing.
 */
export function removeFieldOption(doc: Doc, fieldId: FieldDefId, optionId: OptionId): Doc {
  return A.change(doc, (d) => {
    const def = d.fieldDefs[fieldId];
    if (!def?.options) return;

    delete def.options[optionId];

    for (const event of Object.values(d.events)) {
      const value = event.customFields[fieldId];
      if (value?.kind === 'options') delete value.selected[optionId];
    }
  });
}

/**
 * Whether a stored value still matches what its field says it holds.
 *
 * Retyping a field does not rewrite the values already on events, so this is
 * what lets the editor show one as needing attention rather than rendering a
 * number as though it were a date.
 */
export function valueMatchesType(value: CustomValue, def: FieldDef): boolean {
  switch (def.type) {
    case 'text':
    case 'longtext':
    case 'url':
    case 'email':
    case 'phone':
      return value.kind === 'text';
    case 'number':
    case 'money':
      return value.kind === 'number';
    case 'date':
    case 'datetime':
      return value.kind === 'instant';
    case 'checkbox':
      return value.kind === 'bool';
    case 'select':
    case 'multiselect':
      return value.kind === 'options';
  }
}

/**
 * Which parts of an event a field on the editor stands for.
 *
 * The editor shows a field once it holds something, so taking one off the card
 * means taking out what it holds. A field is rarely one key: "Date" is an
 * instant and the flag saying the hour is not decided yet, and "Booking
 * reference" lives inside `booking` beside a status that has to stay.
 *
 * A custom field is named `custom:<id>` and handled apart from this table,
 * since its key is only known once the trip defines it.
 */
const FIELD_PARTS: Record<string, readonly (keyof TripEvent | `booking.${keyof Booking}`)[]> = {
  when: ['startsAt', 'timeUndecided', 'timezone'],
  duration: ['durationMinutes'],
  city: ['city'],
  place: ['location'],
  confirmation: ['booking.confirmationCode'],
  note: ['booking.note'],
  description: ['description'],
  links: ['links'],
  todos: ['todos'],
  files: ['attachments'],
  transit: ['transit'],
  lodging: ['lodging'],
  route: ['transitIn'],
};

/** Whether this field is one the editor can take off an event. */
export function isClearableField(key: string): boolean {
  return key in FIELD_PARTS || key.startsWith('custom:');
}

/**
 * What a field holds right now, as plain data.
 *
 * Taken before the field is cleared, so that undo can put back exactly what was
 * there -- the same link ids, the same attachments, in one write. Rebuilding a
 * collection through the add functions instead would mint new ids, and a peer
 * that had already merged the removal would end up with two of everything.
 */
export type FieldContents = Record<string, unknown>;

export function fieldContents(event: TripEvent, key: string): FieldContents {
  const held: FieldContents = {};

  if (key.startsWith('custom:')) {
    const fieldId = key.slice('custom:'.length);
    const value = event.customFields?.[fieldId];
    if (value !== undefined) held[key] = clone(value);
    return held;
  }

  for (const part of FIELD_PARTS[key] ?? []) {
    const value = readPart(event, part);
    if (value !== undefined) held[part] = clone(value);
  }

  return held;
}

/**
 * Takes a field off an event, and what it holds with it.
 *
 * Hiding the field and keeping the value was the other way to do this, and it
 * would have meant a document that says one thing and shows another: a
 * confirmation code still in the export, still in search, still on a peer
 * running an older build. Removal is what it looks like. `restoreField` and the
 * undo offered beside it are the way back.
 */
export function clearField(doc: Doc, eventId: EventId, key: string, author: Author): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    if (key.startsWith('custom:')) {
      delete event.customFields[key.slice('custom:'.length)];
      stamp(event, author);
      return;
    }

    for (const part of FIELD_PARTS[key] ?? []) {
      if (part.startsWith('booking.')) {
        delete (event.booking as unknown as Record<string, unknown>)[
          part.slice('booking.'.length)
        ];
      } else {
        delete (event as unknown as Record<string, unknown>)[part];
      }
    }

    // The three keyed collections are declared as always present. Emptying one
    // leaves the map behind rather than the key missing, which is what every
    // reader of an event expects to find.
    if (key === 'links') event.links = {};
    if (key === 'files') event.attachments = {};
    if (key === 'todos') event.todos = {};

    stamp(event, author);
  });
}

/** Puts back what `fieldContents` took, exactly as it was. */
export function restoreField(
  doc: Doc,
  eventId: EventId,
  held: FieldContents,
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const event = d.events[eventId];
    if (!event) return;

    for (const [part, value] of Object.entries(held)) {
      if (part.startsWith('custom:')) {
        event.customFields[part.slice('custom:'.length)] = value as CustomValue;
      } else if (part.startsWith('booking.')) {
        (event.booking as unknown as Record<string, unknown>)[part.slice('booking.'.length)] =
          value;
      } else {
        (event as unknown as Record<string, unknown>)[part] = value;
      }
    }

    stamp(event, author);
  });
}

function readPart(event: TripEvent, part: string): unknown {
  if (part.startsWith('booking.')) {
    return (event.booking as unknown as Record<string, unknown>)[part.slice('booking.'.length)];
  }

  const value = (event as unknown as Record<string, unknown>)[part];

  // An empty collection holds nothing, and restoring one would put back an
  // empty map over whatever had been added in the meantime.
  if (value !== null && typeof value === 'object' && Object.keys(value).length === 0) {
    return undefined;
  }

  return value;
}

/* Automerge proxies cannot be written back into a document at another path, and
 * the value read out of one is a proxy. This is the same trick `addAttachment`
 * uses for a file taken from the trip library. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function deleteFieldDef(doc: Doc, id: FieldDefId, now = Date.now()): Doc {
  return A.change(doc, (d) => {
    const def = d.fieldDefs[id];
    if (!def) return;
    def.deletedAt = now;
  });
}

/*
 * Both of these tolerate a document with nothing in it.
 *
 * A replica starts empty and stays that way until its first sync brings the
 * trip down, so between opening a trip and hearing back from the server there
 * is a real document with no `events` key at all. That is a trip with no events
 * yet, not a broken one.
 */

/** Events that are not tombstoned, which is what every view shows. */
export function liveEvents(doc: TripDoc | undefined): TripEvent[] {
  return Object.values(doc?.events ?? {}).filter((event) => event.deletedAt === undefined);
}

/** Field definitions that are not tombstoned, in the order they are shown. */
export function liveFieldDefs(doc: TripDoc | undefined): FieldDef[] {
  return Object.values(doc?.fieldDefs ?? {})
    .filter((def) => def.deletedAt === undefined)
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

/**
 * Combines several events into one.
 *
 * The rules are fixed rather than asked about field by field, because a dialog
 * with twelve choices in it is slower than doing the merge by hand. What it
 * keeps is what someone merging two versions of the same plan would keep: the
 * earliest start, the primary's name and place, a span covering all of them,
 * everything that was attached to any of them, and the most fixed status --
 * a Confirmed event and a Flexible event together are Confirmed.
 *
 * The others are tombstoned rather than removed, so a peer that was offline
 * learns they went away instead of merging them back.
 */
export function mergeEvents(
  doc: Doc,
  primaryId: EventId,
  otherIds: EventId[],
  author: Author,
): Doc {
  return A.change(doc, (d) => {
    const primary = d.events[primaryId];
    if (!primary) return;

    const others = otherIds
      .filter((id) => id !== primaryId)
      .map((id) => d.events[id])
      .filter((event): event is TripEvent => Boolean(event) && event!.deletedAt === undefined);

    if (others.length === 0) return;

    const all = [primary, ...others];
    const starts = all.map((event) => event.startsAt).filter((at): at is number => at !== undefined);

    if (starts.length > 0) {
      const earliest = Math.min(...starts);

      // The span has to cover everything that was folded in, or merging two
      // adjacent halves of an afternoon would shorten it.
      const latestEnd = Math.max(
        ...all.map((event) =>
          event.startsAt === undefined
            ? -Infinity
            : event.startsAt + (event.durationMinutes ?? 0) * 60_000,
        ),
      );

      primary.startsAt = earliest;
      if (Number.isFinite(latestEnd) && latestEnd > earliest) {
        primary.durationMinutes = Math.round((latestEnd - earliest) / 60_000);
      }
    }

    /*
     * Copies are made rather than the values assigned across.
     *
     * Two things go wrong otherwise. Automerge refuses an undefined value, so
     * `??=` from a field the other event does not have fails outright. And
     * assigning an object that is already in the document creates a reference
     * to it, which Automerge also refuses -- the value has to be a plain copy.
     *
     * Copied through JSON rather than with structuredClone: values read out of
     * a document are proxies, and structuredClone cannot clone those.
     */
    const copy = <T>(value: T): T =>
      value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);

    for (const other of others) {
      primary.booking.status = higherStatus(primary.booking.status, other.booking.status);

      if (primary.city === undefined && other.city !== undefined) {
        primary.city = other.city;
      }
      if (primary.location === undefined && other.location !== undefined) {
        primary.location = copy(other.location);
      }
      if (
        primary.booking.confirmationCode === undefined &&
        other.booking.confirmationCode !== undefined
      ) {
        primary.booking.confirmationCode = other.booking.confirmationCode;
      }

      for (const [linkId, link] of Object.entries(other.links)) {
        if (primary.links[linkId] === undefined) primary.links[linkId] = copy(link);
      }
      for (const [id, attachment] of Object.entries(other.attachments)) {
        if (primary.attachments[id] === undefined) primary.attachments[id] = copy(attachment);
      }
      primary.todos ??= {};
      for (const [id, todo] of Object.entries(other.todos ?? {})) {
        if (primary.todos[id] === undefined) primary.todos[id] = copy(todo);
      }
      for (const [fieldId, value] of Object.entries(other.customFields)) {
        if (primary.customFields[fieldId] === undefined) {
          primary.customFields[fieldId] = copy(value);
        }
      }

      if (other.description) {
        primary.description = primary.description
          ? `${primary.description}\n\n---\n\n${other.description}`
          : other.description;
      }

      other.deletedAt = author.now ?? Date.now();
      stamp(other, author);
    }

    stamp(primary, author);
  });
}

/** Tombstones several events as one change, so undoing it is one step. */
export function deleteEvents(doc: Doc, ids: EventId[], author: Author): Doc {
  return A.change(doc, (d) => {
    const now = author.now ?? Date.now();

    for (const id of ids) {
      const event = d.events[id];
      if (!event || event.deletedAt !== undefined) continue;

      event.deletedAt = now;
      stamp(event, author);
    }
  });
}
