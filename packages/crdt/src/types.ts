import type { BookingStatus } from './status';

export type EventId = string;
export type LinkId = string;
export type AttachmentId = string;
export type FieldDefId = string;
export type OptionId = string;
export type UserId = string;

/** Epoch milliseconds. Every instant in the document is one of these. */
export type Instant = number;

export type EventKind = 'activity' | 'lodging' | 'flight' | 'note';

export type TransitMode = 'walk' | 'transit' | 'drive' | 'fly';

export interface Place {
  label: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface TransitLeg {
  minutes: number;
  mode: TransitMode;
  note?: string;
}

export interface Booking {
  status: BookingStatus;
  /** Why it is not settled yet, or what is still outstanding. */
  note?: string;
  confirmationCode?: string;
}

export interface EventLink {
  url: string;
  title?: string;
  addedAt: Instant;
}

export interface EventAttachment {
  /** SHA-256 of the bytes. The bytes themselves live in the blob store. */
  blobHash: string;
  filename: string;
  mime: string;
  size: number;
  addedAt: Instant;
}

export interface FlightDetails {
  airline?: string;
  number?: string;
  /** IATA codes. */
  from?: string;
  to?: string;
  departsAt?: Instant;
  departsTz?: string;
  arrivesAt?: Instant;
  arrivesTz?: string;
  seat?: string;
  terminal?: string;
  gate?: string;
}

export interface LodgingDetails {
  checkIn?: Instant;
  checkOut?: Instant;
  address?: string;
}

export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'url'
  | 'email'
  | 'phone'
  | 'checkbox'
  | 'select'
  | 'multiselect';

export interface FieldOption {
  label: string;
  color?: string;
}

/**
 * A custom field, defined once for the trip and offered on every event.
 *
 * Definitions live on the trip rather than on an event so that a field means
 * the same thing throughout: two events with a "Cost per person" both refer to
 * this one definition, and renaming it renames it everywhere.
 */
export interface FieldDef {
  id: FieldDefId;
  label: string;
  type: FieldType;
  /** For select and multiselect. Keyed so concurrent additions all survive. */
  options?: Record<OptionId, FieldOption>;
  /** For number: "km", "people", "nights". */
  unit?: string;
  /** For money: an ISO 4217 code. */
  currency?: string;
  /** Absent means the field is offered on every kind of event. */
  appliesTo?: EventKind[];
  order: number;
  deletedAt?: Instant;
}

/**
 * A value for a custom field.
 *
 * Tagged with its own `kind` rather than trusting the definition's `type`. If
 * someone retypes a field from number to text, the values already stored do not
 * silently become text — they keep saying what they are, and the editor can
 * show them as needing attention instead of showing a wrong value confidently.
 */
export type CustomValue =
  | { kind: 'text'; text: string }
  | { kind: 'number'; number: number }
  | { kind: 'instant'; at: Instant }
  | { kind: 'bool'; bool: boolean }
  | { kind: 'options'; selected: Record<OptionId, true> };

export interface TripEvent {
  id: EventId;
  kind: EventKind;
  /** The only thing required to create an event. */
  name: string;
  /** Optional user-assigned colour used by calendar cards. */
  color?: string;
  /** Drives the month view's place ribbon. */
  city?: string;
  location?: Place;
  startsAt?: Instant;
  /**
   * Set when the day is decided and the hour is not. `startsAt` then points at
   * midnight in `timezone`, which puts the event on the right day without
   * claiming it begins then. Absent means the time is part of the plan.
   *
   * A trip is planned in this order — "Thursday, some time" comes days before
   * "Thursday at nine" — and an instant on its own cannot say it.
   */
  timeUndecided?: boolean;
  /** IANA zone of the place. Falls back to the trip's home zone. */
  timezone?: string;
  durationMinutes?: number;
  /** How you get here from the previous event on the same day. */
  transitIn?: TransitLeg;
  booking: Booking;
  /**
   * Plain text for now. Stage 2 replaces this with an Automerge rich-text value
   * edited through ProseMirror, with mentions of events, places, and files.
   */
  description?: string;
  links: Record<LinkId, EventLink>;
  attachments: Record<AttachmentId, EventAttachment>;
  customFields: Record<FieldDefId, CustomValue>;
  flight?: FlightDetails;
  lodging?: LodgingDetails;
  /**
   * Set instead of removing the key, so a peer that was offline during the
   * delete learns about it rather than reviving the event. Swept after 30 days.
   */
  deletedAt?: Instant;
  updatedAt: Instant;
  updatedBy: UserId;
}

export interface TripMeta {
  name: string;
  startsAt?: Instant;
  endsAt?: Instant;
  /** Used for any event that does not name its own zone. */
  homeTimezone: string;
}

/*
 * A type alias rather than an interface. Automerge constrains a document to
 * `Record<string, unknown>`, and only a type alias picks up the implicit index
 * signature that satisfies it — an interface does not, and the assignment fails.
 */
export type TripDoc = {
  meta: TripMeta;
  /** User-assigned colours shared by every occurrence of a city label. */
  cityColors?: Record<string, string>;
  fieldDefs: Record<FieldDefId, FieldDef>;
  events: Record<EventId, TripEvent>;
};
