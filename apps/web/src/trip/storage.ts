import * as A from '@automerge/automerge';
import type { Doc, TripDoc } from '@trip/crdt';
import { createStore, del, get, set } from 'idb-keyval';
import type { TripSummary } from '../lib/api';

const store = createStore('trip-planner', 'documents');

const docKey = (tripId: string) => `doc:${tripId}`;
const syncKey = (tripId: string) => `sync:${tripId}`;

// One key, not one per trip: the list is read and written whole, and the point
// of it is to answer "which trips are there" with no network at all.
const tripListKey = 'trips-list';

/**
 * Keeps the list of trips on the device, so it is there to open a trip from
 * when the server cannot be reached.
 *
 * Every per-trip document is already cached and opens offline, but the list
 * that links to them is fetched fresh each time. Without this the offline app
 * knows every trip yet can show none of them, and the cached documents are
 * unreachable. Written after each successful fetch so it stays current, and it
 * holds the same summaries the server sent -- dates and next-up included, which
 * are a snapshot and so may lag until the next time online.
 */
export async function saveTripList(trips: TripSummary[]): Promise<void> {
  await set(tripListKey, trips, store);
}

export async function loadTripList(): Promise<TripSummary[] | null> {
  return (await get<TripSummary[]>(tripListKey, store)) ?? null;
}

export interface StoredSync {
  /**
   * When this device last heard from the server about this trip.
   *
   * Kept across reloads because it is what the server checks against its
   * tombstone sweep when this device next connects, to decide whether the copy
   * here is still safe to merge.
   */
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

const recoveryKey = (tripId: string) => `recovery:${tripId}`;

export interface Recovery {
  /** The document as it was, saved before it was thrown away. */
  doc: Uint8Array;
  /** How many changes it held that the server had never seen. */
  changeCount: number;
  savedAt: number;
}

/**
 * Keeps a copy of what was discarded, so it can be offered back.
 *
 * Throwing the document away is the only safe answer to a sweep the device
 * missed, but the changes it was carrying were somebody's work. Setting them
 * aside costs a few kilobytes and is the difference between a warning and a
 * loss.
 */
export async function saveRecovery(tripId: string, recovery: Recovery): Promise<void> {
  await set(recoveryKey(tripId), recovery, store);
}

export async function loadRecovery(tripId: string): Promise<Recovery | null> {
  return (await get<Recovery>(recoveryKey(tripId), store)) ?? null;
}

export async function forgetRecovery(tripId: string): Promise<void> {
  await del(recoveryKey(tripId), store);
}
