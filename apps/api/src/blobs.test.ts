import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as A from '@automerge/automerge';
import { addEvent, deleteEvent, TOMBSTONE_TTL_MS, type TripDoc } from '@trip/crdt';
import { trips, users } from '@trip/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { FsBlobStore } from './blobs/FsBlobStore';
import { createDb, runMigrations, type Db } from './db';
import { DocStore } from './docStore';
import { sweepAllTrips } from './sweep';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the blob store', () => {
  let root: string;
  let store: FsBlobStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'trip-blobs-'));
    store = new FsBlobStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('gives back exactly what was put in', async () => {
    const bytes = randomBytes(4096);
    const hash = sha256(bytes);

    expect(await store.has(hash)).toBe(false);
    await store.put(hash, bytes, 'application/pdf');

    expect(await store.has(hash)).toBe(true);
    expect(Buffer.from((await store.get(hash))!)).toEqual(bytes);
  });

  it('treats the same bytes twice as one file', async () => {
    const bytes = randomBytes(128);
    const hash = sha256(bytes);

    await store.put(hash, bytes, 'text/plain');
    await store.put(hash, bytes, 'text/plain');

    // Content addressing is what makes a retried upload free, and what stops
    // the same confirmation attached by two people being stored twice.
    expect(Buffer.from((await store.get(hash))!)).toEqual(bytes);
  });

  it('survives the same file being written twice at once', async () => {
    const bytes = randomBytes(2048);
    const hash = sha256(bytes);

    /*
     * Two uploads of one file arriving together. The temporary name has to be
     * unique per write: named after the process alone, both picked the same
     * one and whichever renamed second found its own file already moved away.
     */
    await Promise.all([
      store.put(hash, bytes, 'application/pdf'),
      store.put(hash, bytes, 'application/pdf'),
      store.put(hash, bytes, 'application/pdf'),
    ]);

    expect(Buffer.from((await store.get(hash))!)).toEqual(bytes);
  });

  it('lists what it holds, so collection knows what to consider', async () => {
    const one = randomBytes(32);
    const two = randomBytes(32);

    await store.put(sha256(one), one, 'text/plain');
    await store.put(sha256(two), two, 'text/plain');

    expect((await store.list()).sort()).toEqual([sha256(one), sha256(two)].sort());
  });

  it('reports nothing for a hash it has never seen', async () => {
    expect(await store.get(sha256(randomBytes(8)))).toBeNull();
    expect(await store.has('0'.repeat(64))).toBe(false);
  });

  it('forgets a blob when told to', async () => {
    const bytes = randomBytes(64);
    const hash = sha256(bytes);

    await store.put(hash, bytes, 'text/plain');
    await store.delete(hash);

    expect(await store.has(hash)).toBe(false);
    // Deleting something already gone is not an error: the sweep runs over
    // whatever it finds and must not fail on a blob a previous run removed.
    await expect(store.delete(hash)).resolves.toBeUndefined();
  });
});

describe('uploading through the API', () => {
  let app: ReturnType<typeof createApp>;
  let root: string;
  let cookie: string;

  beforeEach(async () => {
    const { db } = createDb(':memory:');
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    root = await mkdtemp(join(tmpdir(), 'trip-blobs-'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore(root) });

    // Registration shuts behind the first person to arrive, so these tests act
    // as one person throughout rather than being a new stranger every request.
    const me = await app.request('/api/me');
    cookie = me.headers.get('set-cookie')!.split(';')[0]!;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Every upload here is the same person, carrying the session from above. */
  const asMe = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...init.headers, cookie } });

  it('stores bytes under their own hash and reads them back', async () => {
    const bytes = randomBytes(512);
    const hash = sha256(bytes);

    const put = await asMe(`/api/blobs/${hash}`, {
      method: 'PUT',
      body: bytes,
      headers: { 'content-type': 'application/pdf' },
    });
    expect(put.status).toBe(201);

    const get = await asMe(`/api/blobs/${hash}`);
    expect(get.status).toBe(200);
    expect(Buffer.from(await get.arrayBuffer())).toEqual(bytes);
  });

  it('refuses bytes that are not what the hash says they are', async () => {
    const bytes = randomBytes(64);
    const wrong = sha256(randomBytes(64));

    /*
     * Without this anyone could store whatever they liked under the hash of
     * something else, and every later reader would get bytes that are not what
     * they asked for -- which is the one guarantee content addressing makes.
     */
    const response = await asMe(`/api/blobs/${wrong}`, { method: 'PUT', body: bytes });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe("hash_mismatch");

    expect((await asMe(`/api/blobs/${wrong}`)).status).toBe(404);
  });

  it('refuses a key that is not a hash at all', async () => {
    const response = await asMe('/api/blobs/../../etc/passwd', {
      method: 'PUT',
      body: randomBytes(8),
    });
    expect(response.status).not.toBe(201);
  });
});

describe('the nightly sweep', () => {
  let db: Db;
  let docs: DocStore;

  const now = 1_800_000_000_000;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    docs = new DocStore(db);

    db.insert(users)
      .values({ id: 'u1', displayName: 'Ada', avatarColor: '#136f5b', createdAt: now })
      .run();
    db.insert(trips)
      .values({
        id: 't1',
        name: 'Japan, April',
        homeTimezone: 'Asia/Tokyo',
        createdBy: 'u1',
        createdAt: now,
      })
      .run();
  });

  it('removes old tombstones, keeps recent ones, and records when it ran', () => {
    let doc = docs.create('t1', 'Japan, April', 'Asia/Tokyo');
    doc = addEvent(doc, { id: 'old', name: 'Cancelled tour' }, { userId: 'u1' });
    doc = addEvent(doc, { id: 'recent', name: 'Changed my mind' }, { userId: 'u1' });
    doc = addEvent(doc, { id: 'live', name: 'Still going' }, { userId: 'u1' });
    doc = deleteEvent(doc, 'old', { userId: 'u1', now: now - TOMBSTONE_TTL_MS - 1 });
    doc = deleteEvent(doc, 'recent', { userId: 'u1', now: now - 1000 });

    docs.commit('t1', doc, A.getAllChanges(doc), 'u1');

    const reports = sweepAllTrips(db, docs, now);
    expect(reports).toEqual([{ tripId: 't1', removedEvents: 1, removedFieldDefs: 0 }]);

    const after = docs.load('t1') as TripDoc;
    expect(after.events.old).toBeUndefined();
    expect(after.events.recent?.deletedAt).toBeTypeOf('number');
    expect(after.events.live).toBeDefined();

    /*
     * The watermark is the load-bearing part. A peer that has not synced since
     * before this may still hold the swept event as live, so the sync endpoint
     * uses this to refuse it and make it take a fresh copy.
     */
    const trip = db.select().from(trips).get();
    expect(trip?.tombstonesSweptAt).toBe(now);
  });

  it('does nothing, and claims nothing, when there is nothing to remove', () => {
    let doc = docs.create('t1', 'Japan, April', 'Asia/Tokyo');
    doc = addEvent(doc, { id: 'live', name: 'Still going' }, { userId: 'u1' });
    docs.commit('t1', doc, A.getAllChanges(doc), 'u1');

    expect(sweepAllTrips(db, docs, now)).toEqual([]);
    // No sweep means no watermark, so nobody is forced to resync for nothing.
    expect(db.select().from(trips).get()?.tombstonesSweptAt).toBeNull();
  });
});
