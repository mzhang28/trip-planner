import * as A from '@automerge/automerge';
import { normalizeBookingStatuses, normalizeEventKinds, type Doc } from '@trip/crdt';
import type { TripRole } from '@trip/schema';
import { Code, ConnectError } from '@connectrpc/connect';
import type { DocStore } from '../docStore';
import { canEdit, token } from '../identity';

/**
 * Messages waiting to go out on one stream.
 *
 * Sending is decided in the middle of a synchronous pass over every session on
 * a trip, but a stream can only be written to by the generator Connect is
 * reading from. This sits between the two: whoever decides drops the bytes in,
 * and the generator picks them up when it next gets to run.
 */
class Outbox {
  #waiting: Uint8Array[] = [];
  #wake: (() => void) | null = null;
  #closed = false;

  put(payload: Uint8Array): void {
    if (this.#closed) return;
    this.#waiting.push(payload);
    this.#release();
  }

  close(): void {
    this.#closed = true;
    this.#release();
  }

  #release(): void {
    const wake = this.#wake;
    this.#wake = null;
    wake?.();
  }

  async *take(signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const stop = () => this.close();
    signal.addEventListener('abort', stop);

    try {
      while (true) {
        // Everything already queued goes out before anything is awaited, so a
        // burst that arrived together is not held up one message per tick.
        while (this.#waiting.length > 0) {
          yield this.#waiting.shift() as Uint8Array;
        }

        if (this.#closed || signal.aborted) return;

        await new Promise<void>((resolve) => {
          this.#wake = resolve;
        });
      }
    } finally {
      signal.removeEventListener('abort', stop);
      this.close();
    }
  }
}

/**
 * One client's live connection to one trip.
 *
 * `state` is Automerge's record of what this client is believed to have
 * already. It belongs to the connection rather than to the person, because two
 * tabs showing the same trip are two peers that have seen different things.
 *
 * No role is kept here. What someone may do can be changed by an owner while
 * they are connected, so it is read afresh on each message instead.
 */
export interface Session {
  readonly id: string;
  readonly tripId: string;
  readonly userId: string;
  state: A.SyncState;
  readonly outbox: Outbox;
}

/**
 * Everyone who currently has a trip open, and the machinery for carrying
 * changes between them.
 *
 * Sessions live in memory and nowhere else. A restart drops them all, every
 * client reconnects, and each negotiates again from its own document — what is
 * held here is only a record of what has already been said, so losing it costs
 * one extra exchange and never any content. It does mean two API processes
 * cannot see each other's sessions: live updates reach the people connected to
 * the same process, and anyone else when they next reconnect.
 */
export class SyncSessions {
  readonly #byId = new Map<string, Session>();
  readonly #byTrip = new Map<string, Set<Session>>();

  constructor(private readonly docs: DocStore) {
    docs.watch((tripId, doc) => this.#flush(tripId, doc));
  }

  open(tripId: string, userId: string): Session {
    const session: Session = {
      id: token(18),
      tripId,
      userId,
      state: A.initSyncState(),
      outbox: new Outbox(),
    };

    this.#byId.set(session.id, session);

    const onTrip = this.#byTrip.get(tripId) ?? new Set<Session>();
    onTrip.add(session);
    this.#byTrip.set(tripId, onTrip);

    return session;
  }

  close(session: Session): void {
    session.outbox.close();
    this.#byId.delete(session.id);

    const onTrip = this.#byTrip.get(session.tripId);
    if (!onTrip) return;

    onTrip.delete(session);
    if (onTrip.size === 0) this.#byTrip.delete(session.tripId);
  }

  /**
   * Everything this session is owed, until the client goes away.
   *
   * Opens by saying what this side has, rather than waiting to be asked. A
   * client that has just connected is the one most likely to be behind, and it
   * has no way of knowing whether it is.
   */
  async *stream(session: Session, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const doc = this.docs.load(session.tripId);
    if (doc) this.#offer(session, doc);

    yield* session.outbox.take(signal);
  }

  /**
   * Finds the session an id names, as long as it belongs to this person.
   *
   * An unknown id and somebody else's id are refused alike, so guessing at ids
   * says nothing about which ones exist. Either way the client's next move is
   * the same: open a stream and use the id it is given.
   */
  sessionOf(sessionId: string, userId: string): Session {
    const session = this.#byId.get(sessionId);

    if (!session || session.userId !== userId) {
      throw new ConnectError('no such session', Code.NotFound);
    }

    return session;
  }

  /**
   * Takes one sync message from a client, and lets everyone else hear what was
   * in it.
   *
   * Nothing is awaited between reading the document and replacing it. Automerge
   * marks a document outdated once a message has been applied to it, so a
   * second message arriving in a gap here would be working from a handle the
   * first had already superseded.
   */
  receive(session: Session, role: TripRole, payload: Uint8Array): void {
    const current = this.docs.load(session.tripId);
    if (!current) throw new ConnectError('no such trip', Code.NotFound);

    if (payload.length === 0) {
      this.#offer(session, current);
      return;
    }

    const [received, state] = A.receiveSyncMessage(current, session.state, payload);
    session.state = state;

    /*
     * Whether this was a write is decided by what the message turned out to
     * contain, not by whether one was sent. Every sync message carries the
     * sender's heads so the other side knows what to send back, so a viewer
     * doing nothing but reading still sends messages — refusing those would
     * stop a viewer seeing the trip at all.
     */
    const contributed = A.getChanges(current, received);

    if (contributed.length > 0 && !canEdit(role)) {
      /*
       * Drop the cached document rather than keep either version. The changes
       * were refused so `received` must not be kept, and `current` is outdated
       * the moment a message is applied to it, so the next reader loads a fresh
       * copy from SQLite.
       */
      this.docs.forget(session.tripId);
      throw new ConnectError('this trip is read-only for you', Code.PermissionDenied);
    }

    const doc = normalizeEventKinds(normalizeBookingStatuses(received));

    if (contributed.length === 0) {
      // Nothing to record, but the handle has still moved on, and this client
      // is still owed whatever its message was asking for.
      this.docs.advance(session.tripId, doc);
      this.#offer(session, doc);
      return;
    }

    /*
     * Committing is what tells everyone. The store announces the new document
     * to its watchers, which is where the other sessions on this trip pick it
     * up -- and so does an agent's edit over MCP, by the same route.
     */
    this.docs.commit(session.tripId, doc, A.getChanges(current, doc), session.userId);
  }

  /** Offers every session on a trip whatever it has not been given yet. */
  #flush(tripId: string, doc: Doc): void {
    const onTrip = this.#byTrip.get(tripId);
    if (!onTrip) return;

    for (const session of onTrip) this.#offer(session, doc);
  }

  /**
   * Sends this session the next thing it is missing, if there is one.
   *
   * Includes the session a message just came from: Automerge's protocol is an
   * alternating exchange, so the sender is usually owed a reply of its own.
   */
  #offer(session: Session, doc: Doc): void {
    const [state, message] = A.generateSyncMessage(doc, session.state);
    session.state = state;
    if (message) session.outbox.put(message);
  }
}
