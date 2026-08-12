import * as A from '@automerge/automerge';
import { canSyncIncrementally, normalizeBookingStatuses, type Doc } from '@trip/crdt';
import { trips } from '@trip/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { canEdit } from '../identity';

const bodySchema = z.object({
  /**
   * The server's own sync state from the previous exchange, handed back by the
   * client. Automerge's sync protocol needs each side to remember what it
   * believes the other has; keeping that on the client rather than in a session
   * makes the endpoint stateless, so it survives a restart and does not care
   * which process answers.
   */
  syncState: z.string().optional(),
  message: z.string(),
  /** When this client last completed a sync, used against the sweep horizon. */
  lastSyncedAt: z.number().optional(),
  /**
   * Whether this client is carrying anything of its own.
   *
   * A client with an empty document cannot resurrect a swept event, so it is
   * safe to sync with whatever its history says -- and that is the state it is
   * in right after being told to start again.
   */
  hasLocalChanges: z.boolean().default(true),
});

const decode = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
const encode = (value: Uint8Array) => Buffer.from(value).toString('base64');

export function syncRoutes() {
  const app = new Hono<AppEnv>();

  app.post('/:tripId', async (c) => {
    const { db, docs } = c.var.services;
    const tripId = c.req.param('tripId');

    const membership = c.var.membership;
    if (!membership || membership.tripId !== tripId) {
      return c.json({ error: 'not_a_member' }, 403);
    }

    const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'bad_request' }, 400);

    const trip = db
      .select({ sweptAt: trips.tombstonesSweptAt })
      .from(trips)
      .where(eq(trips.id, tripId))
      .get();

    if (!trip) return c.json({ error: 'no_such_trip' }, 404);

    /*
     * A client that has not synced since before the sweep may still be holding
     * events whose tombstones have been removed. Merging it would put those
     * events back, so it is told to start again from a fresh copy instead.
     */
    if (
      !canSyncIncrementally(
        parsed.data.lastSyncedAt,
        trip.sweptAt ?? undefined,
        parsed.data.hasLocalChanges,
      )
    ) {
      return c.json({ type: 'resync_required', sweptAt: trip.sweptAt }, 409);
    }

    /*
     * From here to the response there is nothing to await, which is what keeps
     * two concurrent syncs of one trip from interleaving. Automerge marks a
     * document outdated once a message has been applied to it, so anything
     * added in between would need a lock to stop the second request advancing a
     * handle the first had already superseded.
     */
    {
      const current = docs.load(tripId);
      if (!current) return c.json({ error: 'no_such_trip' }, 404);

      let state = parsed.data.syncState
        ? A.decodeSyncState(decode(parsed.data.syncState))
        : A.initSyncState();

      let doc: Doc = current;
      const incoming = decode(parsed.data.message);

      if (incoming.length > 0) {
        [doc, state] = A.receiveSyncMessage(current, state, incoming);

        /*
         * Whether this was a write is decided by what the message turned out to
         * contain, not by whether one was sent. Every sync message carries the
         * sender's heads so the other side knows what to send back, so a viewer
         * doing nothing but reading still posts messages — refusing those would
         * stop a viewer seeing the trip at all.
         */
        const contributed = A.getChanges(current, doc);

        if (contributed.length > 0 && !canEdit(membership.role)) {
          /*
           * Drop the cached document rather than keeping either version. The
           * changes were refused so `doc` must not be kept, and `current` is
           * outdated the moment a message is applied to it, so the next request
           * reads a fresh copy from SQLite.
           */
          docs.forget(tripId);
          return c.json({ error: 'read_only' }, 403);
        }

        doc = normalizeBookingStatuses(doc);
        docs.commit(tripId, doc, A.getChanges(current, doc), membership.userId);
      }

      const [nextState, reply] = A.generateSyncMessage(doc, state);

      return c.json({
        syncState: encode(A.encodeSyncState(nextState)),
        message: reply ? encode(reply) : null,
        syncedAt: Date.now(),
      });
    }
  });

  return app;
}
