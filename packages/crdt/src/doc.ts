import * as A from '@automerge/automerge';
import { higherStatus } from './status';
import type {
  AttachmentId,
  CustomValue,
  EventAttachment,
  EventId,
  EventKind,
  FieldDef,
  FieldDefId,
  FieldOption,
  Instant,
  LinkId,
  OptionId,
  TripDoc,
  TripEvent,
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
    meta: { name, homeTimezone },
    fieldDefs: {},
    events: {},
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
 * and whether it is booked once they know.
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
        target[key] = value;
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

    event.attachments[attachmentId] = attachment;
    stamp(event, author);
  });
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

/** Every blob hash the trip still points at, for deciding what may be deleted. */
export function referencedBlobs(doc: TripDoc | undefined): Set<string> {
  const hashes = new Set<string>();

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
 * everything that was attached to any of them, and the most settled status --
 * a booked half and an idea half together are a booking.
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
