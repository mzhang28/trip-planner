import { referencedBlobs, sweepTombstones, type TripDoc } from '@trip/crdt';
import { trips } from '@trip/schema';
import { eq } from 'drizzle-orm';
import type { Db } from './db';
import type { BlobStore } from './blobs/BlobStore';
import type { DocStore } from './docStore';

export interface SweepReport {
  tripId: string;
  removedEvents: number;
  removedFieldDefs: number;
}

/**
 * Removes tombstones past thirty days, across every trip.
 *
 * Setting `deletedAt` is what tells peers about a delete; this is what reclaims
 * the space. Recording when it ran is the important part: a peer that has not
 * synced since before this may still be holding a swept event as live, so the
 * sync endpoint refuses it and makes it take a fresh copy instead.
 */
export function sweepAllTrips(db: Db, docs: DocStore, now = Date.now()): SweepReport[] {
  const reports: SweepReport[] = [];

  for (const trip of db.select({ id: trips.id }).from(trips).all()) {
    const doc = docs.load(trip.id);
    if (!doc) continue;

    const result = sweepTombstones(doc, now);
    if (result.removedEvents.length === 0 && result.removedFieldDefs.length === 0) continue;

    // A sweep is a change like any other, so it reaches everyone through the
    // usual sync rather than needing a channel of its own.
    docs.commit(trip.id, result.doc, [], 'system');
    db.update(trips).set({ tombstonesSweptAt: now }).where(eq(trips.id, trip.id)).run();

    reports.push({
      tripId: trip.id,
      removedEvents: result.removedEvents.length,
      removedFieldDefs: result.removedFieldDefs.length,
    });
  }

  return reports;
}

/**
 * Deletes blobs no trip points at any more.
 *
 * Tombstoned events count as pointing at theirs: a delete can be undone, and
 * the files have to still be there when it is. Only once the tombstone itself
 * is swept do its attachments become unreachable.
 *
 * The bytes are named by their own hash, so a file on two events is one blob
 * and is kept while either still refers to it.
 */
export async function collectBlobs(
  db: Db,
  docs: DocStore,
  blobs: BlobStore,
  known: string[],
): Promise<number> {
  const referenced = new Set<string>();

  for (const trip of db.select({ id: trips.id }).from(trips).all()) {
    const doc = docs.load(trip.id);
    if (!doc) continue;

    for (const hash of referencedBlobs(doc as TripDoc)) referenced.add(hash);
  }

  let removed = 0;
  for (const hash of known) {
    if (referenced.has(hash)) continue;
    await blobs.delete(hash);
    removed += 1;
  }

  return removed;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Runs the sweep and the blob collection once at startup, then daily. */
export function scheduleSweep(db: Db, docs: DocStore, blobs: BlobStore): () => void {
  const run = async () => {
    try {
      sweepAllTrips(db, docs);

      /*
       * Collection runs after the sweep, in that order on purpose. A tombstoned
       * event still points at its files so an undo can bring them back, so the
       * files only become unreachable once the tombstone itself has gone.
       */
      if (blobs.list) {
        await collectBlobs(db, docs, blobs, await blobs.list());
      }
    } catch (error) {
      // A failed sweep must not take the server down with it. Tombstones
      // outliving thirty days costs space; an unreachable server costs the app.
      console.error('nightly cleanup failed', error);
    }
  };

  void run();
  const timer = setInterval(() => void run(), DAY_MS);
  timer.unref?.();

  return () => clearInterval(timer);
}
