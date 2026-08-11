import * as A from '@automerge/automerge';
import type { Doc, TripDoc } from '@trip/crdt';
import { createStore, del, get, set } from 'idb-keyval';

const store = createStore('trip-planner', 'documents');

const docKey = (tripId: string) => `doc:${tripId}`;
const syncKey = (tripId: string) => `sync:${tripId}`;

export interface StoredSync {
  /** The server's sync state, opaque here and handed straight back to it. */
  serverState?: string;
  lastSyncedAt?: number;
}

/**
 * Keeps the trip on the device.
 *
 * Saved after every local change rather than on a timer, because the case this
 * exists for is the browser being closed or the tab being killed with no
 * warning. A trip rearranged on a plane has to survive that.
 */
export async function saveDoc(tripId: string, doc: Doc): Promise<void> {
  await set(docKey(tripId), A.save(doc), store);
}

export async function loadDoc(tripId: string): Promise<Doc | null> {
  const bytes = await get<Uint8Array>(docKey(tripId), store);
  return bytes ? A.load<TripDoc>(bytes) : null;
}

export async function saveSync(tripId: string, state: StoredSync): Promise<void> {
  await set(syncKey(tripId), state, store);
}

export async function loadSync(tripId: string): Promise<StoredSync> {
  return (await get<StoredSync>(syncKey(tripId), store)) ?? {};
}

/**
 * Throws away the local copy of a trip.
 *
 * Used when the server says a resync is required: the local document predates a
 * tombstone sweep and may still hold events whose delete markers are gone, so
 * merging it would put them back.
 */
export async function forgetDoc(tripId: string): Promise<void> {
  await del(docKey(tripId), store);
  await del(syncKey(tripId), store);
}
