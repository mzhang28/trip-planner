import * as A from '@automerge/automerge';
import { createTrip, eventSearchText, type Doc, type TripDoc } from '@trip/crdt';
import { eventLinks, events, tripChanges, tripDocs } from '@trip/schema';
import { eq } from 'drizzle-orm';
import type { Db, Executor } from './db';

/**
 * Holds the Automerge document for each open trip, and keeps SQLite in step
 * with it.
 *
 * Documents are cached in memory because loading one costs a parse of the whole
 * snapshot, and a trip being synced is touched on every message. Only this
 * module reads or writes the document; everything else in the API reads the
 * projection tables instead.
 */
export class DocStore {
  readonly #cache = new Map<string, Doc>();

  constructor(private readonly db: Db) {}

  create(tripId: string, name: string, homeTimezone: string): Doc {
    const doc = createTrip(name, homeTimezone);
    this.#cache.set(tripId, doc);
    this.#persistSnapshot(tripId, doc);
    this.#project(tripId, doc);
    return doc;
  }

  load(tripId: string): Doc | null {
    const cached = this.#cache.get(tripId);
    if (cached) return cached;

    const row = this.db
      .select({ snapshot: tripDocs.snapshot })
      .from(tripDocs)
      .where(eq(tripDocs.tripId, tripId))
      .get();

    if (!row) return null;

    let doc = A.load<TripDoc>(new Uint8Array(row.snapshot));

    // Changes that arrived since the last compaction are stored separately, so
    // the snapshot on its own is behind until they are applied.
    const pending = this.db
      .select({ change: tripChanges.change })
      .from(tripChanges)
      .where(eq(tripChanges.tripId, tripId))
      .all();

    if (pending.length > 0) {
      doc = A.applyChanges(doc, pending.map((p) => new Uint8Array(p.change)))[0];
    }

    this.#cache.set(tripId, doc);
    return doc;
  }

  /**
   * Replaces the cached document and records the changes that produced it.
   *
   * The caller passes the changes rather than the document they came from,
   * because it has already had to work them out to decide whether the sender
   * was allowed to make them, and asking Automerge to diff the same pair of
   * documents twice is both wasted work and a second chance to get it wrong.
   */
  commit(tripId: string, next: Doc, added: A.Change[], actorId: string): void {
    /*
     * The cache advances even when nothing was contributed. Automerge marks the
     * document a sync message was applied to as outdated, so holding on to the
     * previous handle would make the next message fail against a document that
     * can no longer be changed.
     */
    this.#cache.set(tripId, next);
    if (added.length === 0) return;

    const now = Date.now();
    const rows = added.map((change) => ({
      tripId,
      hash: A.decodeChange(change).hash,
      actorId,
      change: Buffer.from(change),
      receivedAt: now,
    }));

    // A change that arrives twice is the same row, so re-delivery costs nothing
    // and needs no bookkeeping on the sending side.
    this.db.insert(tripChanges).values(rows).onConflictDoNothing().run();

    this.#project(tripId, next);
  }

  /**
   * Folds accumulated changes into the snapshot and deletes them.
   *
   * This is what stops history growing without bound: the changes are already
   * represented in the saved document, so keeping them costs space and buys
   * nothing once every peer has caught up.
   */
  compact(tripId: string): void {
    const doc = this.load(tripId);
    if (!doc) return;

    this.db.transaction((tx) => {
      this.#persistSnapshot(tripId, doc, tx);
      tx.delete(tripChanges).where(eq(tripChanges.tripId, tripId)).run();
    });
  }

  #persistSnapshot(tripId: string, doc: Doc, tx: Executor = this.db): void {
    const snapshot = Buffer.from(A.save(doc));
    const heads = JSON.stringify(A.getHeads(doc));
    const updatedAt = Date.now();

    tx.insert(tripDocs)
      .values({ tripId, snapshot, heads, updatedAt })
      .onConflictDoUpdate({
        target: tripDocs.tripId,
        set: { snapshot, heads, updatedAt },
      })
      .run();
  }

  /**
   * Rewrites the relational view of the trip.
   *
   * Deleted and rewritten wholesale rather than diffed. A trip is small enough
   * that the write costs less than the bookkeeping to work out what changed,
   * and rebuilding from the document means the projection cannot drift from it.
   */
  #project(tripId: string, doc: Doc): void {
    const snapshot = doc as TripDoc;

    this.db.transaction((tx) => {
      tx.delete(events).where(eq(events.tripId, tripId)).run();

      const eventRows = Object.values(snapshot.events).map((event) => ({
        tripId,
        id: event.id,
        kind: event.kind,
        name: event.name,
        city: event.city ?? null,
        locationLabel: event.location?.label ?? null,
        locationAddress: event.location?.address ?? null,
        lat: event.location?.lat ?? null,
        lng: event.location?.lng ?? null,
        startsAt: event.startsAt ?? null,
        timezone: event.timezone ?? null,
        durationMinutes: event.durationMinutes ?? null,
        bookingStatus: event.booking.status,
        bookingNote: event.booking.note ?? null,
        confirmationCode: event.booking.confirmationCode ?? null,
        description: event.description ?? null,
        searchText: eventSearchText(event, snapshot.fieldDefs),
        deletedAt: event.deletedAt ?? null,
        updatedAt: event.updatedAt,
        updatedBy: event.updatedBy,
      }));

      if (eventRows.length > 0) {
        tx.insert(events).values(eventRows).run();
      }

      const linkRows = Object.values(snapshot.events).flatMap((event) =>
        Object.entries(event.links).map(([id, link]) => ({
          id,
          eventId: event.id,
          url: link.url,
          title: link.title ?? null,
          addedAt: link.addedAt,
        })),
      );

      if (linkRows.length > 0) {
        tx.insert(eventLinks).values(linkRows).run();
      }
    });
  }

  forget(tripId: string): void {
    this.#cache.delete(tripId);
  }
}
