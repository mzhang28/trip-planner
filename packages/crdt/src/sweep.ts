import * as A from '@automerge/automerge';
import type { Doc } from './doc';
import type { Instant, TripDoc } from './types';

/**
 * How long a tombstone is kept before the key is removed outright.
 *
 * Long enough that a device left in a drawer for a few weeks still learns about
 * a delete rather than reviving the event, short enough that a trip does not
 * carry its deletions forever.
 */
export const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SweepResult {
  doc: Doc;
  /** Ids whose keys were removed, for the caller to drop from the projection. */
  removedEvents: string[];
  removedFieldDefs: string[];
}

/**
 * Removes tombstones older than the horizon.
 *
 * Setting `deletedAt` tells peers about a delete; this is what reclaims the
 * space, and it is only safe once every peer has had a fair chance to see the
 * marker. A peer that has not synced since before this ran cannot merge safely
 * afterwards — it might still be carrying the event as live and add it back —
 * so the caller records when the sweep happened and refuses incremental sync to
 * anyone older than that.
 *
 * Values belonging to a swept field definition go with it, otherwise events
 * keep paying for a field nobody can see any more.
 */
export function sweepTombstones(doc: Doc, now: Instant = Date.now()): SweepResult {
  const horizon = now - TOMBSTONE_TTL_MS;
  const snapshot = doc as TripDoc;

  const removedEvents = Object.values(snapshot.events)
    .filter((event) => event.deletedAt !== undefined && event.deletedAt < horizon)
    .map((event) => event.id);

  const removedFieldDefs = Object.values(snapshot.fieldDefs)
    .filter((def) => def.deletedAt !== undefined && def.deletedAt < horizon)
    .map((def) => def.id);

  if (removedEvents.length === 0 && removedFieldDefs.length === 0) {
    return { doc, removedEvents, removedFieldDefs };
  }

  const swept = A.change(doc, (d) => {
    for (const id of removedEvents) {
      delete d.events[id];
    }

    for (const id of removedFieldDefs) {
      delete d.fieldDefs[id];

      for (const event of Object.values(d.events)) {
        if (event.customFields[id] !== undefined) {
          delete event.customFields[id];
        }
      }
    }
  });

  return { doc: swept, removedEvents, removedFieldDefs };
}

/**
 * Whether a peer can merge safely, or has to throw away its copy first.
 *
 * The danger is only ever a peer that holds something. Anything it carries from
 * before a sweep may include events whose delete markers have been removed, so
 * merging it would put them back.
 *
 * A peer carrying nothing is safe whatever its history says. That is not a
 * corner case: it is exactly the state a peer is in immediately after being told
 * to start again, and refusing it there would leave it asking and being refused
 * for ever.
 */
export function canSyncIncrementally(
  lastSyncedAt: Instant | undefined,
  tombstonesSweptAt: Instant | undefined,
  peerHasChanges = true,
): boolean {
  if (tombstonesSweptAt === undefined) return true;
  if (!peerHasChanges) return true;
  if (lastSyncedAt === undefined) return false;
  return lastSyncedAt >= tombstonesSweptAt;
}
