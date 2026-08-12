import * as A from '@automerge/automerge';
import { referencedBlobs, type TripDoc } from '@trip/crdt';
import { tripMembers, trips, type TripRole } from '@trip/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ArchiveError, readArchive, withFreshIds, withoutUnavailableFiles } from '../archive/read';
import { archiveStream, contentDisposition } from '../archive/write';
import type { AppEnv } from '../context';
import { token } from '../identity';
import { requireMembership } from '../middleware';

/**
 * A whole trip's worth of scans and photographs, with room to spare.
 *
 * Larger than any single upload by a wide margin because an archive is all of
 * them at once, and smaller than a trip could theoretically grow because the
 * body is read into memory before any of it can be looked at.
 */
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

/**
 * Taking a trip out of here, and bringing one back in.
 *
 * Export is offered to anyone on the trip, not only its owner: a viewer can
 * already read every event and download every attachment one at a time, so
 * withholding the zip would cost them an afternoon and withhold nothing.
 *
 * Import always makes a new trip rather than writing into one that exists.
 * Merging an archive into a live document has no answer for what should happen
 * to an event both sides changed, and guessing at one would lose somebody's
 * work silently. A new trip is a copy, which is what "import" means everywhere
 * else, and the two can be compared side by side afterwards.
 */
export function archiveRoutes() {
  const app = new Hono<AppEnv>();

  app.get('/:tripId/export', requireMembership, (c) => {
    const { db, docs, blobs } = c.var.services;
    const membership = c.var.membership!;

    const doc = docs.load(membership.tripId);
    if (!doc) return c.json({ error: 'no_such_trip' }, 404);

    // The row rather than the document, because the row is the name shown in
    // the trip list, which is the name whoever clicked download is expecting.
    const trip = db
      .select({ name: trips.name })
      .from(trips)
      .where(eq(trips.id, membership.tripId))
      .get();

    return new Response(archiveStream(doc as TripDoc, blobs), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': contentDisposition(trip?.name ?? (doc as TripDoc).meta.name),
        // Unlike a blob, this is not named after its contents: the same URL
        // answers differently the moment anybody edits the trip.
        'cache-control': 'no-store',
      },
    });
  });

  app.post('/import', async (c) => {
    const { db, docs, blobs } = c.var.services;
    const { userId } = c.var.identity;

    // Checked before reading, so an oversized upload is refused rather than
    // buffered in full and then refused.
    const declared = Number(c.req.header('content-length'));
    if (Number.isFinite(declared) && declared > MAX_ARCHIVE_BYTES) {
      return c.json({ error: 'too_large' }, 413);
    }

    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength === 0) return c.json({ error: 'empty' }, 400);
    if (body.byteLength > MAX_ARCHIVE_BYTES) return c.json({ error: 'too_large' }, 413);

    let archive;
    try {
      archive = readArchive(body);
    } catch (error) {
      if (error instanceof ArchiveError) {
        return c.json({ error: error.code, message: error.message }, 400);
      }
      throw error;
    }

    /*
     * An attachment counts as available if its bytes are in the archive or
     * already in the store. The second case is what makes re-importing an
     * archive whose files were stripped out still work on the server that
     * wrote it, and it is free to check: the hash is the name.
     */
    const available = new Set<string>();
    for (const hash of referencedBlobs(archive.manifest.doc)) {
      if (archive.files.has(hash) || (await blobs.has(hash))) available.add(hash);
    }

    const { doc: whole, dropped } = withoutUnavailableFiles(archive.manifest.doc, available);
    const restored = withFreshIds(whole, (prefix) => `${prefix}_${token(12)}`);

    /*
     * Bytes first, then the document that points at them. The other order
     * leaves a window in which the trip is readable and its attachments are
     * not, and a reader who hits it sees a download that fails rather than one
     * that is not there yet.
     */
    for (const [hash, bytes] of archive.files) {
      if (!available.has(hash)) continue;
      await blobs.put(hash, bytes, restored.files?.[hash]?.mime ?? 'application/octet-stream');
    }

    const id = `t_${token(16)}`;
    const now = Date.now();
    const { name, homeTimezone } = restored.meta;

    db.transaction((tx) => {
      tx.insert(trips).values({ id, name, homeTimezone, createdBy: userId, createdAt: now }).run();
      tx.insert(tripMembers)
        .values({
          tripId: id,
          userId,
          role: 'owner',
          grantedVia: null,
          firstOpenedAt: now,
          lastOpenedAt: now,
        })
        .run();
    });

    /*
     * One change holds the whole trip, so there is no state in which half of it
     * exists. Passed through JSON on the way in because Automerge refuses an
     * undefined value outright, and an absent optional field is worth nothing
     * to it either way.
     */
    docs.adopt(id, A.from<TripDoc>(JSON.parse(JSON.stringify(restored)) as TripDoc));

    return c.json(
      {
        id,
        name,
        homeTimezone,
        role: 'owner' satisfies TripRole,
        events: Object.keys(restored.events).length,
        files: Object.keys(restored.files ?? {}).length,
        /** Named so the import can say what did not survive it, not just how many. */
        droppedFiles: dropped.map((file) => file.filename),
      },
      201,
    );
  });

  return app;
}
