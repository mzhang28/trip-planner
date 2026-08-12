import * as A from '@automerge/automerge';
import { ConnectError, Code } from '@connectrpc/connect';
import { normalizeBookingStatuses, normalizeEventKinds, type Doc, type TripDoc } from '@trip/crdt';
import type { SyncEvent } from '@trip/proto';
import { syncClient } from '../lib/syncClient';
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

/** Longest wait between attempts to get the connection back. */
const SLOWEST_RETRY_MS = 30_000;

/**
 * One trip's replica: the document, the connection, and what the UI subscribes
 * to.
 *
 * Every change is applied locally and saved first, then sent. That ordering is
 * what makes the app usable with no signal — nothing waits on a response, and a
 * failed send is a retry rather than a lost edit.
 *
 * While there is a connection it is held open, and the server sends other
 * people's changes down it as they are made. That is the difference between a
 * trip that updates when you touch it and one that updates when anybody does.
 */
export class TripStore {
  #doc: Doc;
  #phase: SyncPhase = 'idle';
  #sync: StoredSync = {};
  #listeners = new Set<() => void>();
  #snapshot: TripState;
  #recoverable: number | undefined;

  /**
   * Automerge's record of what the server is believed to have already.
   *
   * Reset with every connection. The server keeps the matching record in
   * memory only, so a server that restarted has forgotten what it knew about
   * this device; starting both sides afresh costs one extra exchange and means
   * the two can never disagree about where they left off.
   */
  #localState = A.initSyncState();

  /** Names this device's side of the conversation. Absent when not connected. */
  #sessionId: string | null = null;

  #connection: AbortController | null = null;
  #closed = false;
  #failures = 0;

  /** Cuts short a wait, when there is now a reason not to keep waiting. */
  #wake: (() => void) | null = null;

  #pushing: Promise<void> | null = null;
  #pushAgain = false;

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
    const normalized = normalizeEventKinds(normalizeBookingStatuses(loaded));
    if (normalized !== loaded) await saveDoc(tripId, normalized);

    const store = new TripStore(tripId, normalized, sync);

    // A copy set aside in an earlier session is still worth offering back.
    const recovery = await loadRecovery(tripId);
    if (recovery) store.#recoverable = recovery.changeCount;

    store.#listen();
    void store.#stayConnected();
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
      // Drop the connection rather than wait for it to time out, so coming back
      // starts a new one instead of writing into a socket that is already gone.
      this.#connection?.abort();
    };

    const onOnline = () => {
      this.#failures = 0;
      this.#wake?.();
      this.#connection?.abort();
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);

    this.#teardown = () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }

  dispose(): void {
    this.#closed = true;
    this.#teardown?.();
    this.#teardown = null;
    this.#connection?.abort();
    this.#connection = null;
    // A loop asleep between attempts would otherwise hold on until its timer
    // ran out, keeping this trip's document alive after the page left it.
    this.#wake?.();
    this.#listeners.clear();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Stable between notifications, as useSyncExternalStore requires. */
  getSnapshot = (): TripState => this.#snapshot;

  /**
   * Whether the trip itself has reached this device yet.
   *
   * A replica opened on a device that has never held this trip starts as an
   * empty document, and stays empty until the server's first message lands.
   * Sending succeeds before then -- there is nothing to send, so it succeeds
   * trivially -- which is why finishing a send is not on its own a reason to
   * say the trip is safe here.
   */
  #arrived(): boolean {
    return 'meta' in this.#doc;
  }

  /** Idle once the trip is here; until then a send that landed proves nothing. */
  #settled(): SyncPhase {
    return this.#arrived() ? 'idle' : 'syncing';
  }

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
   * Applies a change locally, saves it, and sends it when it can.
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
   * Sends whatever this device is holding that the server has not got.
   *
   * Public because the recovery banner reaches for it after merging a set-aside
   * copy back in, and because a test can wait on it.
   */
  async sync(): Promise<void> {
    if (this.#pushing) {
      /*
       * A burst of edits produces one more send after the current one rather
       * than a send each. An Automerge message carries everything outstanding
       * at the moment it is made, so the last one covers the lot.
       */
      this.#pushAgain = true;
      return this.#pushing;
    }

    this.#pushing = this.#push().finally(() => {
      this.#pushing = null;
      if (this.#pushAgain) {
        this.#pushAgain = false;
        void this.sync();
      }
    });

    return this.#pushing;
  }

  async #push(): Promise<void> {
    const sessionId = this.#sessionId;

    // Nothing to send into. The connection loop is already trying to get one
    // back, and the change is saved on the device until it does.
    if (!sessionId) {
      this.#phase = 'pending';
      this.#publish();
      return;
    }

    const [state, message] = A.generateSyncMessage(this.#doc, this.#localState);
    this.#localState = state;

    if (!message) {
      this.#phase = this.#settled();
      this.#publish();
      return;
    }

    this.#phase = 'syncing';
    this.#publish();

    try {
      const { syncedAt } = await syncClient.push({ sessionId, payload: message });

      this.#sync = { lastSyncedAt: Number(syncedAt) };
      await saveSync(this.tripId, this.#sync);

      this.#phase = this.#settled();
      this.#publish();
    } catch (error) {
      /*
       * A session the server does not recognise is not a failure to retry
       * against: it means the connection this message belonged to is gone, and
       * the reply is to open a new one. Anything else is the network, and the
       * edit is already on the device, so there is nothing to recover — only
       * something to send again.
       */
      if (ConnectError.from(error).code === Code.NotFound) {
        this.#sessionId = null;
        this.#connection?.abort();
      }

      this.#phase = 'pending';
      this.#publish();
    }
  }

  /**
   * Holds a connection open for as long as this trip is on screen.
   *
   * A dropped stream is the ordinary case rather than an error: phones sleep,
   * proxies time out idle connections, and servers restart. Each attempt after
   * a failure waits longer than the last, up to half a minute, so a server that
   * is actually down is not hammered by every open tab.
   */
  async #stayConnected(): Promise<void> {
    while (!this.#closed) {
      if (!navigator.onLine) {
        this.#phase = 'pending';
        this.#publish();

        // Waits to be told the network is back rather than asking repeatedly.
        // There is nothing a retry could discover that the event will not say.
        await this.#waitToBeWoken();
        continue;
      }

      await this.#runConnection();

      if (this.#closed) return;
      await this.#backOff();
    }
  }

  async #runConnection(): Promise<void> {
    const connection = new AbortController();
    this.#connection = connection;

    try {
      const stream = syncClient.subscribe(
        {
          tripId: this.tripId,
          lastSyncedAt:
            this.#sync.lastSyncedAt === undefined ? undefined : BigInt(this.#sync.lastSyncedAt),
          /*
           * A device with an empty document cannot bring a swept event back, so
           * the server can admit it whatever its history says. This is exactly
           * the state a device is in just after being told to start again.
           */
          hasLocalChanges: A.getAllChanges(this.#doc).length > 0,
        },
        { signal: connection.signal },
      );

      for await (const event of stream) {
        await this.#received(event);
      }
    } catch {
      // Losing the stream says nothing about the edits, which are on the device
      // either way. The loop above will try again.
      this.#sessionId = null;
      this.#failures += 1;

      if (this.#closed) return;

      if (this.#phase !== 'resync-required') this.#phase = 'pending';
      this.#publish();
      return;
    }

    // The server ended the stream rather than the connection breaking, which is
    // what it does after telling a client to start again.
    this.#sessionId = null;
  }

  async #received(event: SyncEvent): Promise<void> {
    switch (event.event.case) {
      case 'opened': {
        this.#sessionId = event.event.value.sessionId;
        this.#failures = 0;

        /*
         * Both sides start the conversation over. The server has just made a
         * fresh record of what this device has, so a stale one here would have
         * it hold back changes the server is waiting for.
         */
        this.#localState = A.initSyncState();

        if (this.#phase === 'pending' || this.#phase === 'resync-required') {
          this.#phase = this.#settled();
        }
        this.#publish();

        // Say what this device has, without waiting to be asked for it.
        void this.sync();
        return;
      }

      case 'message': {
        const before = this.#doc;
        const [received, state] = A.receiveSyncMessage(
          this.#doc,
          this.#localState,
          event.event.value.payload,
        );

        this.#doc = normalizeEventKinds(normalizeBookingStatuses(received));
        this.#localState = state;
        this.#sync = { lastSyncedAt: Number(event.event.value.syncedAt) };

        if (A.getChanges(before, this.#doc).length > 0) {
          await saveDoc(this.tripId, this.#doc);
          await saveSync(this.tripId, this.#sync);
        }

        this.#publish();

        // Automerge's protocol is an alternating exchange, so what arrived is
        // usually owed an answer -- and this is also how someone else's edit,
        // once applied, gets acknowledged back to the server.
        void this.sync();
        return;
      }

      case 'resyncRequired':
        await this.#startAgain();
        return;
    }
  }

  /**
   * Waits before trying the connection again.
   *
   * A stream that ended without failing is reopened at once: that is what the
   * server does after telling a client to start again, and making someone wait
   * for a fresh copy of their trip would be waiting for nothing. Only a failure
   * earns a delay, and each consecutive one doubles it.
   */
  async #backOff(): Promise<void> {
    if (this.#failures === 0) return;

    const delay = Math.min(500 * 2 ** (this.#failures - 1), SLOWEST_RETRY_MS);
    await this.#waitToBeWoken(delay);
  }

  /** Sleeps until woken, or until `delay` passes when one is given. */
  async #waitToBeWoken(delay?: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = delay === undefined ? null : setTimeout(resolve, delay);

      this.#wake = () => {
        if (timer !== null) clearTimeout(timer);
        resolve();
      };
    });

    this.#wake = null;
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
    this.#sessionId = null;
    this.#phase = 'resync-required';
    this.#recoverable = unsent > 0 ? unsent : undefined;
    this.#publish();

    // The server ends the stream after saying this, and the connection loop
    // opens another one -- this time with an empty document, which it accepts.
    this.#failures = 0;
  }

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

    this.#doc = normalizeEventKinds(
      normalizeBookingStatuses(A.merge(this.#doc, A.load<TripDoc>(recovery.doc))),
    );
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
