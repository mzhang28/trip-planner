import { resolve } from 'node:path';
import * as A from '@automerge/automerge';
import { addEvent, type Doc } from '@trip/crdt';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { createDb, runMigrations, type Db } from './db';
import { FsBlobStore } from './blobs/FsBlobStore';
import { DocStore } from './docStore';

type App = ReturnType<typeof createApp>;

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const un64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

/**
 * One browser: a cookie jar and a document.
 *
 * The point of testing through the app rather than against DocStore directly is
 * that a person's replica only ever learns about the trip through sync
 * messages, so anything the protocol fails to carry shows up here.
 */
class Client {
  cookie = '';
  doc: Doc = A.init();
  #server: string | undefined;
  #local = A.initSyncState();
  lastSyncedAt: number | undefined;

  constructor(
    private readonly app: App,
    readonly name: string,
  ) {}

  async request(path: string, init: RequestInit = {}) {
    const res = await this.app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...init.headers,
      },
    });

    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0]!;

    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  /** Exchanges messages until neither side has anything left to say. */
  async sync(tripId: string): Promise<void> {
    for (let round = 0; round < 12; round++) {
      const [nextLocal, message] = A.generateSyncMessage(this.doc, this.#local);
      this.#local = nextLocal;

      const { status, body } = await this.request(`/api/sync/${tripId}`, {
        method: 'POST',
        body: JSON.stringify({
          syncState: this.#server,
          message: b64(message ?? new Uint8Array()),
          lastSyncedAt: this.lastSyncedAt,
        }),
      });

      if (status !== 200) {
        throw new Error(`${this.name}: sync returned ${status} ${JSON.stringify(body)}`);
      }

      this.#server = body.syncState;
      this.lastSyncedAt = body.syncedAt;

      if (body.message) {
        [this.doc, this.#local] = A.receiveSyncMessage(this.doc, this.#local, un64(body.message));
      } else if (!message) {
        return;
      }
    }
  }

  events(): string[] {
    return Object.values((this.doc as { events: Record<string, { name: string }> }).events)
      .map((event) => event.name)
      .sort();
  }
}

describe('sync over HTTP', () => {
  let app: App;
  let db: Db;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore('/tmp/trip-test-blobs') });
  });

  async function newTrip(client: Client) {
    const { status, body } = await client.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan, April', homeTimezone: 'Asia/Tokyo' }),
    });
    expect(status).toBe(201);
    await client.sync(body.id);
    return body.id as string;
  }

  it('gives a visitor an identity without anyone signing in', async () => {
    const ada = new Client(app, 'ada');
    const { status, body } = await ada.request('/api/me');

    expect(status).toBe(200);
    expect(body.userId).toMatch(/^u_/);
    expect(ada.cookie).toContain('trip_session=');
  });

  it('carries events made offline to a second person through a share link', async () => {
    const ada = new Client(app, 'ada');
    const bo = new Client(app, 'bo');

    const tripId = await newTrip(ada);

    // Offline: two events, no requests in between.
    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    ada.doc = addEvent(ada.doc, { id: 'e2', name: 'Nishiki Market' }, { userId: 'ada' });
    await ada.sync(tripId);

    const share = await ada.request(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'editor' }),
    });
    expect(share.status).toBe(201);

    const redeem = await bo.request(`/api/share/${share.body.token}`, { method: 'POST' });
    expect(redeem.status).toBe(200);
    expect(redeem.body.role).toBe('editor');

    await bo.sync(tripId);
    expect(bo.events()).toEqual(['Fushimi Inari', 'Nishiki Market']);
  });

  it('merges edits two people made to the same event while both were offline', async () => {
    const ada = new Client(app, 'ada');
    const bo = new Client(app, 'bo');

    const tripId = await newTrip(ada);
    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    await ada.sync(tripId);

    const share = await ada.request(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'editor' }),
    });
    await bo.request(`/api/share/${share.body.token}`, { method: 'POST' });
    await bo.sync(tripId);

    // Both go offline and touch different fields of the one event.
    bo.doc = A.change(bo.doc, (d: any) => {
      d.events.e1.city = 'Kyoto';
    });
    ada.doc = A.change(ada.doc, (d: any) => {
      d.events.e1.startsAt = 1_776_000_000_000;
    });

    await bo.sync(tripId);
    await ada.sync(tripId);
    await bo.sync(tripId);

    for (const client of [ada, bo]) {
      const event = (client.doc as any).events.e1;
      expect(event.city, `${client.name} lost the city`).toBe('Kyoto');
      expect(event.startsAt, `${client.name} lost the time`).toBe(1_776_000_000_000);
    }
  });

  it('refuses someone who holds no membership', async () => {
    const ada = new Client(app, 'ada');
    const stranger = new Client(app, 'stranger');

    const tripId = await newTrip(ada);

    // Ada arrived first, so registration shut behind her. Letting others in
    // again is what makes this a test of membership rather than of the door.
    await ada.request('/api/instance', {
      method: 'PATCH',
      body: JSON.stringify({ registrationOpen: true }),
    });

    const { status } = await stranger.request(`/api/sync/${tripId}`, {
      method: 'POST',
      body: JSON.stringify({ message: b64(new Uint8Array()) }),
    });

    expect(status).toBe(403);
  });

  it('lets a viewer read but not write', async () => {
    const ada = new Client(app, 'ada');
    const bo = new Client(app, 'bo');

    const tripId = await newTrip(ada);
    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    await ada.sync(tripId);

    const share = await ada.request(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'viewer' }),
    });
    await bo.request(`/api/share/${share.body.token}`, { method: 'POST' });

    await bo.sync(tripId);
    expect(bo.events()).toEqual(['Fushimi Inari']);

    bo.doc = addEvent(bo.doc, { id: 'e2', name: 'Sneaky edit' }, { userId: 'bo' });
    await expect(bo.sync(tripId)).rejects.toThrow(/403/);
  });

  it('lists a trip once someone has opened its link, so it is there tomorrow', async () => {
    const ada = new Client(app, 'ada');
    const bo = new Client(app, 'bo');

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
    const ada = new Client(app, 'ada');
    const tripId = await newTrip(ada);

    const share = await ada.request(`/api/trips/${tripId}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'viewer' }),
    });

    const redeem = await ada.request(`/api/share/${share.body.token}`, { method: 'POST' });
    expect(redeem.body.role).toBe('owner');
  });

  it('keeps the relational projection in step with the document', async () => {
    const ada = new Client(app, 'ada');
    const tripId = await newTrip(ada);

    ada.doc = addEvent(ada.doc, { id: 'e1', name: 'Fushimi Inari' }, { userId: 'ada' });
    ada.doc = A.change(ada.doc, (d: any) => {
      d.events.e1.city = 'Kyoto';
      d.events.e1.booking.confirmationCode = '7K2QLM';
    });
    await ada.sync(tripId);

    const rows = db.$client
      .prepare('select id, name, city, search_text from events where trip_id = ?')
      .all(tripId) as Array<{ id: string; name: string; city: string; search_text: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.city).toBe('Kyoto');
    // The projection is what the MCP tools and full-text search read, so the
    // searchable text has to be there rather than only in the document.
    expect(rows[0]!.search_text).toContain('7K2QLM');
  });
});
