import * as A from '@automerge/automerge';
import { normalizeBookingStatuses, type Doc, type TripDoc } from '@trip/crdt';
import {
  forgetDoc,
  forgetRecovery,
  loadDoc,
  loadRecovery,
  loadSync,
  saveDoc,
  saveRecovery,
  saveSync,
  type StoredSync,
} from './storage';

/**
 * What has happened to this person's changes.
 *
 * There is deliberately no separate state for "offline". Whether the network is
 * down or the server did not answer, the same thing is true of the edit and the
 * same thing happens next: it is on this device and it will be sent again.
 * `navigator.onLine` only knows whether there is a link, not whether anything
 * is reachable over it, so treating it as the difference would sometimes say
 * "offline" to someone whose connection is fine.
 */
export type SyncPhase = 'idle' | 'syncing' | 'pending' | 'resync-required';

export interface TripState {
  doc: Doc;
  phase: SyncPhase;
  lastSyncedAt?: number;
  /**
   * How many local changes were set aside when the copy was discarded, so the
   * banner can offer them back. Absent when there is nothing waiting.
   */
  recoverableChanges?: number;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const un64 = (value: string) => Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0));

/**
 * One trip's replica: the document, the sync loop, and what the UI subscribes to.
 *
 * Every change is applied locally and saved first, then sent. That ordering is
 * what makes the app usable with no signal — nothing waits on a response, and a
 * failed send is a retry rather than a lost edit.
 */
export class TripStore {
  #doc: Doc;
  #phase: SyncPhase = 'idle';
  #sync: StoredSync = {};
  #localState = A.initSyncState();
  #listeners = new Set<() => void>();
  #snapshot: TripState;
  #inFlight: Promise<void> | null = null;
  #dirty = false;
  #retryAt: ReturnType<typeof setTimeout> | null = null;
  #failures = 0;

  private constructor(
    readonly tripId: string,
    doc: Doc,
    sync: StoredSync,
  ) {
    this.#doc = doc;
    this.#sync = sync;
    this.#snapshot = { doc, phase: 'idle', lastSyncedAt: sync.lastSyncedAt };
  }

  static async open(tripId: string): Promise<TripStore> {
    const [stored, sync] = await Promise.all([loadDoc(tripId), loadSync(tripId)]);
    const loaded = stored ?? A.init<TripDoc>();
    const normalized = normalizeBookingStatuses(loaded);
    if (normalized !== loaded) await saveDoc(tripId, normalized);

    const store = new TripStore(tripId, normalized, sync);

    // A copy set aside in an earlier session is still worth offering back.
    const recovery = await loadRecovery(tripId);
    if (recovery) store.#recoverable = recovery.changeCount;

    store.#listen();
    void store.sync();
    return store;
  }

  #teardown: (() => void) | null = null;

  /**
   * Reacts to the network coming and going.
   *
   * Losing the network changes what the badge should say straight away, not
   * whenever something next happens to try to sync. Someone who has just gone
   * into a tunnel and typed an event needs to be told it is being kept locally
   * at the moment they type it.
   */
  #listen(): void {
    const onOffline = () => {
      this.#phase = 'pending';
      this.#publish();
    };
    const onOnline = () => void this.sync();

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    this.#teardown = () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }

  dispose(): void {
    this.#teardown?.();
    this.#teardown = null;
    if (this.#retryAt) clearTimeout(this.#retryAt);
    this.#retryAt = null;
    this.#listeners.clear();
  }

  /**
   * Marks the sync as not having landed, and arranges to try again.
   *
   * Without this a change that failed to send would sit there until the person
   * made another edit or the browser noticed the network return — so one bad
   * response could leave an edit stranded on the device indefinitely while the
   * badge quietly said it was fine.
   *
   * The first retry is almost immediate, because most failures are a server
   * that was busy for a moment. From there the delay doubles up to half a
   * minute, so one that is actually down is not hammered.
   */
  #failed(): void {
    this.#phase = 'pending';
    this.#publish();

    if (this.#retryAt) return;

    const delay = Math.min(500 * 2 ** this.#failures, 30_000);
    this.#failures += 1;

    this.#retryAt = setTimeout(() => {
      this.#retryAt = null;
      void this.sync();
    }, delay);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Stable between notifications, as useSyncExternalStore requires. */
  getSnapshot = (): TripState => this.#snapshot;

  #publish(patch: Partial<TripState> = {}): void {
    this.#snapshot = {
      doc: this.#doc,
      phase: this.#phase,
      lastSyncedAt: this.#sync.lastSyncedAt,
      recoverableChanges: this.#recoverable,
      ...patch,
    };
    for (const listener of this.#listeners) listener();
  }

  /**
   * Applies a change locally, saves it, and pushes when it can.
   *
   * The caller gets the new state immediately; whether the network is there
   * only affects when other people see it.
   */
  change(mutate: (doc: Doc) => Doc): void {
    this.#doc = mutate(this.#doc);
    this.#publish();

    void saveDoc(this.tripId, this.#doc);
    void this.sync();
  }

  /**
   * Runs the sync protocol to completion.
   *
   * Calls that arrive while one is running set a flag instead of queueing, so a
   * burst of edits produces one more round after the current one rather than a
   * round each. Automerge messages carry everything outstanding, so the last
   * round covers the lot.
   */
  async sync(): Promise<void> {
    if (this.#inFlight) {
      this.#dirty = true;
      return this.#inFlight;
    }

    this.#inFlight = this.#runSync().finally(() => {
      this.#inFlight = null;
      if (this.#dirty) {
        this.#dirty = false;
        void this.sync();
      }
    });

    return this.#inFlight;
  }

  async #runSync(): Promise<void> {
    if (!navigator.onLine) {
      this.#phase = 'pending';
      this.#publish();
      return;
    }

    this.#phase = 'syncing';
    this.#publish();

    try {
      for (let round = 0; round < 12; round++) {
        const [nextLocal, message] = A.generateSyncMessage(this.#doc, this.#localState);
        this.#localState = nextLocal;

        const response = await fetch(`/api/sync/${this.tripId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            syncState: this.#sync.serverState,
            message: b64(message ?? new Uint8Array()),
            lastSyncedAt: this.#sync.lastSyncedAt,
            hasLocalChanges: A.getAllChanges(this.#doc).length > 0,
          }),
        });

        if (response.status === 409) {
          await this.#startAgain();
          return;
        }

        if (!response.ok) {
          this.#failed();
          return;
        }

        const body = (await response.json()) as {
          syncState: string;
          message: string | null;
          syncedAt: number;
        };

        this.#sync = { serverState: body.syncState, lastSyncedAt: body.syncedAt };

        if (body.message) {
          const before = this.#doc;
          const [received, nextLocalState] = A.receiveSyncMessage(
            this.#doc,
            this.#localState,
            un64(body.message),
          );
          this.#doc = normalizeBookingStatuses(received);
          this.#localState = nextLocalState;

          if (A.getChanges(before, this.#doc).length > 0) {
            await saveDoc(this.tripId, this.#doc);
          }
        } else if (!message) {
          break;
        }
      }

      await saveSync(this.tripId, this.#sync);
      this.#failures = 0;
      this.#phase = 'idle';
      this.#publish();
    } catch {
      // A failed fetch is the network, not a bug. The edit is already on the
      // device, so there is nothing to recover -- only something to retry.
      this.#failed();
    }
  }

  /**
   * Discards the local copy and takes a fresh one, keeping what it was carrying.
   *
   * The server refuses to merge a document older than its last tombstone sweep,
   * because it may still hold events whose delete markers have been removed.
   * Merging it would put deleted events back, so there is no version of this
   * that keeps the document.
   *
   * What it was carrying is another matter. Changes the server never saw are
   * somebody's work, so they are set aside before the document goes and offered
   * back once the fresh copy has arrived.
   */
  async #startAgain(): Promise<void> {
    const unsent = A.getChanges(A.init<TripDoc>(), this.#doc).length;

    if (unsent > 0) {
      await saveRecovery(this.tripId, {
        doc: A.save(this.#doc),
        changeCount: unsent,
        savedAt: Date.now(),
      });
    }

    await forgetDoc(this.tripId);

    this.#doc = A.init<TripDoc>();
    this.#localState = A.initSyncState();
    this.#sync = {};
    this.#phase = 'resync-required';
    this.#recoverable = unsent > 0 ? unsent : undefined;
    this.#publish();

    await this.#runSync();
  }

  #recoverable: number | undefined;

  /**
   * Merges the set-aside copy back in.
   *
   * Re-applied rather than restored: the fresh document is the one the server
   * will accept, and the old changes go on top of it as ordinary edits. Anything
   * the sweep removed stays removed, because the fresh copy has no key for it
   * and merging a change to a key that is gone adds nothing back.
   */
  async recoverSetAside(): Promise<void> {
    const recovery = await loadRecovery(this.tripId);
    if (!recovery) return;

    this.#doc = normalizeBookingStatuses(A.merge(this.#doc, A.load<TripDoc>(recovery.doc)));
    this.#recoverable = undefined;

    await saveDoc(this.tripId, this.#doc);
    await forgetRecovery(this.tripId);

    this.#publish();
    void this.sync();
  }

  /** Throws the set-aside copy away, when the person says they do not want it. */
  async discardSetAside(): Promise<void> {
    await forgetRecovery(this.tripId);
    this.#recoverable = undefined;
    this.#publish();
  }
}
