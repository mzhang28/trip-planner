import { resolve } from 'node:path';
import * as A from '@automerge/automerge';
import { Code, ConnectError, createClient, type Client as RpcClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { addEvent, type Doc } from '@trip/crdt';
import { SyncService, type SyncEvent } from '@trip/proto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createDb, runMigrations, type Db } from './db';
import { FsBlobStore } from './blobs/FsBlobStore';
import { DocStore } from './docStore';

type App = ReturnType<typeof createApp>;

/**
 * Keeps asking until it is true, or gives up and says what it was waiting for.
 *
 * Live sync has no moment a caller can await: an edit reaches the other person
 * through their own open stream, in its own time. What a test can say is that
 * it arrives, so that is what these wait on.
 */
async function waitFor(check: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error(`timed out waiting for ${what}`);
}

/**
 * One browser: a cookie jar, a document, and a connection.
 *
 * The point of testing through the app rather than against DocStore directly is
 * that a person's replica only ever learns about the trip through sync
 * messages, so anything the protocol fails to carry shows up here.
 */
class Client {
  cookie = '';
  doc: Doc = A.init();
  resyncRequired = false;

  readonly #rpc: RpcClient<typeof SyncService>;
  #state = A.initSyncState();
  #sessionId: string | null = null;
  #connection: AbortController | null = null;
  #lastSyncedAt: number | undefined;

  constructor(
    private readonly app: App,
    readonly name: string,
  ) {
    this.#rpc = createClient(
      SyncService,
      createConnectTransport({
        // Absolute because a Request needs one; nothing listens on it, since
        // every call is handed to the app rather than sent anywhere.
        baseUrl: 'http://trips.test/api/rpc',
        useBinaryFormat: true,
        fetch: (input, init) => this.#send(input, init),
      }),
    );
  }

  /** Hands the call straight to the app, with this browser's cookie on it. */
  async #send(...[input, init]: Parameters<typeof fetch>): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.cookie) headers.set('cookie', this.cookie);

    const response = await this.app.fetch(new Request(String(input), { ...init, headers }));

    this.#keepCookie(response);
    return response;
  }

  #keepCookie(response: Response): void {
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;
  }

  async request(path: string, init: RequestInit = {}) {
    const res = await this.app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...init.headers,
      },
    });

    this.#keepCookie(res);

    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /**
   * Opens the stream and waits for the session, so a caller can push at once.
   *
   * Everything after the first event is handled in the background, which is
   * where another person's edits arrive.
   */
  async connect(tripId: string): Promise<void> {
    const connection = new AbortController();
    this.#connection = connection;

    const events = this.#rpc.subscribe(
      {
        tripId,
        lastSyncedAt: this.#lastSyncedAt === undefined ? undefined : BigInt(this.#lastSyncedAt),
        hasLocalChanges: A.getAllChanges(this.doc).length > 0,
      },
      { signal: connection.signal },
    );

    const stream = events[Symbol.asyncIterator]();
    const first = await stream.next();

    if (first.done) throw new Error(`${this.name}: the stream ended before it opened`);
    await this.#apply(first.value);

    void this.#drain(stream);
  }

  async #drain(stream: AsyncIterator<SyncEvent>): Promise<void> {
    try {
      for (;;) {
        const next = await stream.next();
        if (next.done) return;
        await this.#apply(next.value);
      }
    } catch {
      // Either the test closed this client or the server ended the stream.
      // Neither is worth failing over here; what matters is the document.
    }
  }

  async #apply(event: SyncEvent): Promise<void> {
    switch (event.event.case) {
      case 'opened':
        this.#sessionId = event.event.value.sessionId;
        this.#state = A.initSyncState();
        return;

      case 'message': {
        [this.doc, this.#state] = A.receiveSyncMessage(
          this.doc,
          this.#state,
          event.event.value.payload,
        );
        this.#lastSyncedAt = Number(event.event.value.syncedAt);

        // The protocol alternates, so what arrived is usually owed a reply.
        await this.push();
        return;
      }

      case 'resyncRequired':
        this.resyncRequired = true;
        this.#sessionId = null;
        return;
    }
  }

  /** Offers the server whatever this replica holds that it may not have. */
  async push(): Promise<void> {
    if (!this.#sessionId) return;

    const [state, message] = A.generateSyncMessage(this.doc, this.#state);
    this.#state = state;
    if (!message) return;

    const { syncedAt } = await this.#rpc.push({ sessionId: this.#sessionId, payload: message });
    this.#lastSyncedAt = Number(syncedAt);
  }

  /** Which conversation this client is in, for a test that outlives it. */
  get sessionId(): string | null {
    return this.#sessionId;
  }

  /** Speaks on a named session, to ask whether the server still has it. */
  async pushOn(sessionId: string): Promise<void> {
    await this.#rpc.push({ sessionId, payload: new Uint8Array() });
  }

  close(): void {
    this.#connection?.abort();
    this.#connection = null;
    this.#sessionId = null;
  }

  /** Empty until the first message arrives, which is a state a test waits out. */
  events(): string[] {
    const events = (this.doc as Partial<{ events: Record<string, { name: string }> }>).events;

    return Object.values(events ?? {})
      .map((event) => event.name)
      .sort();
  }
}

describe('live sync', () => {
  let app: App;
  let db: Db;
  let open: Client[] = [];

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore('/tmp/trip-test-blobs') });
    open = [];
  });

  afterEach(() => {
    for (const client of open) client.close();
  });

  function client(name: string): Client {
    const created = new Client(app, name);
    open.push(created);
    return created;
  }

  async function newTrip(owner: Client) {
    const { status, body } = await owner.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan, April', homeTimezone: 'Asia/Tokyo' }),
    });

    expect(status).toBe(201);
    await owner.connect(body.id);
    await waitFor(() => A.getAllChanges(owner.doc).length > 0, 'the new trip to arrive');

    return body.id as string;
  }

  /** Gives an editor's membership to a second person and connects them. */
  async function invite(owner: Client, guest: Client, tripId: string, role = 'editor') {
    const share = await owner.request(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    });
    expect(share.status).toBe(201);

    const redeem = await guest.request(`/api/share/${share.body.token}`, { method: 'POST' });
    expect(redeem.status).toBe(200);

    await guest.connect(tripId);

    // A guest has nothing until the first message lands, and editing a document
    // that has not arrived writes into a trip with no events map at all.
    await waitFor(() => A.getAllChanges(guest.doc).length > 0, `${guest.name} to receive the trip`);

    return share.body.token as string;
  }

  it('gives a visitor an identity without anyone signing in', async () => {
    const ada = client('ada');
    const { status, body } = await ada.request('/api/me');

    expect(status).toBe(200);
    expect(body.userId).toMatch(/^u_/);
    expect(ada.cookie).toContain('trip_session=');
  });

  it('carries an edit to someone who never asked for it', async () => {
    const ada = client('ada');
    const bo = client('bo');

    const tripId = await newTrip(ada);
    await invite(ada, bo, tripId);

    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    await ada.push();

    // Bo makes no request of any kind from here on. This is the whole point of
    // the stream: the edit is delivered rather than collected.
    await waitFor(() => bo.events().includes('Fushimi Inari'), "ada's event to reach bo");
  });

  it('carries an edit each way between two people at once', async () => {
    const ada = client('ada');
    const bo = client('bo');

    const tripId = await newTrip(ada);
    await invite(ada, bo, tripId);

    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    bo.doc = addEvent(bo.doc, { id: 'e2', name: 'Nishiki Market' }, { userId: 'bo' });

    await Promise.all([ada.push(), bo.push()]);

    for (const person of [ada, bo]) {
      await waitFor(
        () => person.events().join() === ['Fushimi Inari', 'Nishiki Market'].join(),
        `${person.name} to hold both events`,
      );
    }
  });

  it('carries events made offline to a second person through a share link', async () => {
    const ada = client('ada');
    const bo = client('bo');

    const tripId = await newTrip(ada);

    // Offline: two events, nothing sent in between.
    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    ada.doc = addEvent(ada.doc, { id: 'e2', name: 'Nishiki Market' }, { userId: 'ada' });
    await ada.push();

    await invite(ada, bo, tripId);

    await waitFor(
      () => bo.events().join() === ['Fushimi Inari', 'Nishiki Market'].join(),
      'bo to receive both events',
    );
  });

  it('merges edits two people made to the same event while both were offline', async () => {
    const ada = client('ada');
    const bo = client('bo');

    const tripId = await newTrip(ada);
    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    await ada.push();

    await invite(ada, bo, tripId);
    await waitFor(() => bo.events().includes('Fushimi Inari'), 'bo to catch up');

    // Both touch different fields of the one event before either sends.
    bo.doc = A.change(bo.doc, (d: any) => {
      d.events.e1.city = 'Kyoto';
    });
    ada.doc = A.change(ada.doc, (d: any) => {
      d.events.e1.startsAt = 1_776_000_000_000;
    });

    await Promise.all([bo.push(), ada.push()]);

    for (const person of [ada, bo]) {
      await waitFor(() => {
        const event = (person.doc as any).events.e1;
        return event.city === 'Kyoto' && event.startsAt === 1_776_000_000_000;
      }, `${person.name} to hold both edits`);
    }
  });

  it('refuses someone who holds no membership', async () => {
    const ada = client('ada');
    const stranger = client('stranger');

    const tripId = await newTrip(ada);

    // Ada arrived first, so registration shut behind her. Letting others in
    // again is what makes this a test of membership rather than of the door.
    await ada.request('/api/instance', {
      method: 'PATCH',
      body: JSON.stringify({ registrationOpen: true }),
    });

    await expect(stranger.connect(tripId)).rejects.toMatchObject({
      code: Code.PermissionDenied,
    });
  });

  it('lets a viewer read but not write', async () => {
    const ada = client('ada');
    const bo = client('bo');

    const tripId = await newTrip(ada);
    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    await ada.push();

    await invite(ada, bo, tripId, 'viewer');
    await waitFor(() => bo.events().includes('Fushimi Inari'), 'bo to read the trip');

    bo.doc = addEvent(bo.doc, { id: 'e2', name: 'Sneaky edit' }, { userId: 'bo' });

    const refused = await bo.push().catch((error: unknown) => ConnectError.from(error));
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.PermissionDenied);

    // And the refusal held: the event never reached the trip.
    expect(ada.events()).toEqual(['Fushimi Inari']);
  });

  it('forgets a session when the client holding it goes away', async () => {
    const ada = client('ada');
    const tripId = await newTrip(ada);

    const abandoned = ada.sessionId;
    expect(abandoned).not.toBeNull();
    ada.close();

    /*
     * Sessions are held in memory for as long as their stream is open, so a
     * server that did not notice a browser leaving would accumulate one of
     * these per page ever loaded, and offer every change to all of them.
     */
    let refusal: unknown = null;
    for (let attempt = 0; attempt < 200 && refusal === null; attempt++) {
      refusal = await ada
        .pushOn(abandoned!)
        .then(() => null)
        .catch((error: unknown) => error);

      if (refusal === null) await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(ConnectError.from(refusal).code).toBe(Code.NotFound);
  });

  it('sends a client back for a fresh copy when its own is older than the sweep', async () => {
    const ada = client('ada');
    const tripId = await newTrip(ada);

    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    await ada.push();
    ada.close();

    const swept = await ada.request(`/api/test/force-resync/${tripId}`, { method: 'POST' });
    expect(swept.status).toBe(200);

    await ada.connect(tripId);
    expect(ada.resyncRequired).toBe(true);
  });

  it('lists a trip once someone has opened its link, so it is there tomorrow', async () => {
    const ada = client('ada');
    const bo = client('bo');

    const tripId = await newTrip(ada);
    const share = await ada.request(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'editor' }),
    });

    // Bo has no account yet, and registration shut behind ada. The link is the
    // invitation, so until bo follows it there is nothing to list.
    const before = await bo.request('/api/trips');
    expect(before.status).toBe(401);

    const redeemed = await bo.request(`/api/share/${share.body.token}`, { method: 'POST' });
    expect(redeemed.status).toBe(200);

    const after = await bo.request('/api/trips');
    expect(after.body.trips).toHaveLength(1);
    expect(after.body.trips[0].name).toBe('Japan, April');
  });

  it('does not downgrade an owner who follows their own viewer link', async () => {
    const ada = client('ada');
    const tripId = await newTrip(ada);

    const share = await ada.request(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'viewer' }),
    });

    const redeem = await ada.request(`/api/share/${share.body.token}`, { method: 'POST' });
    expect(redeem.body.role).toBe('owner');
  });

  it('keeps the relational projection in step with the document', async () => {
    const ada = client('ada');
    const tripId = await newTrip(ada);

    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    ada.doc = A.change(ada.doc, (d: any) => {
      d.events.e1.city = 'Kyoto';
      d.events.e1.booking.confirmationCode = '7K2QLM';
    });
    await ada.push();

    await waitFor(() => {
      const rows = db.$client
        .prepare('select id from events where trip_id = ?')
        .all(tripId) as unknown[];
      return rows.length === 1;
    }, 'the event to reach the projection');

    const rows = db.$client
      .prepare('select id, name, city, search_text from events where trip_id = ?')
      .all(tripId) as Array<{ id: string; name: string; city: string; search_text: string }>;

    expect(rows[0]!.city).toBe('Kyoto');
    // The projection is what the MCP tools and full-text search read, so the
    // searchable text has to be there rather than only in the document.
    expect(rows[0]!.search_text).toContain('7K2QLM');
  });
});
