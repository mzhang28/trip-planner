import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import * as A from '@automerge/automerge';
import {
  addAttachment,
  addEvent,
  addFieldDef,
  addLink,
  addTodo,
  addTripFile,
  deleteEvent,
  deleteFieldDef,
  setCityColor,
  setCustomField,
  updateEvent,
  updateTripMeta,
  type Doc,
  type TripDoc,
} from '@trip/crdt';
import { events as eventRows } from '@trip/schema';
import { eq } from 'drizzle-orm';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tripDocSchema } from './archive/manifest';
import { readArchive, withoutUnavailableFiles } from './archive/read';
import { archiveBytes, archiveFilename, exportableDoc } from './archive/write';
import { createApp } from './app';
import { FsBlobStore } from './blobs/FsBlobStore';
import { createDb, runMigrations, type Db } from './db';
import { DocStore } from './docStore';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const author = { userId: 'u1', now: 1_700_000_000_000 };

describe('what an export keeps', () => {
  it('leaves out tombstoned events, and keeps the files they had on them', () => {
    let doc: Doc = A.from<TripDoc>({
      meta: { name: 'Japan, April', homeTimezone: 'Asia/Tokyo' },
      files: {},
      fieldDefs: {},
      events: {},
    });

    doc = addEvent(doc, { id: 'live', name: 'Fushimi Inari' }, author);
    doc = addEvent(doc, { id: 'gone', name: 'Cancelled tour' }, author);

    const attached = 'a'.repeat(64);
    const orphaned = 'b'.repeat(64);
    const file = (blobHash: string, filename: string) => ({
      blobHash,
      filename,
      mime: 'application/pdf',
      size: 12,
      addedAt: author.now,
    });

    doc = addAttachment(doc, 'live', 'a_1', file(attached, 'ticket.pdf'), author);
    doc = addAttachment(doc, 'gone', 'a_2', file(orphaned, 'cancelled.pdf'), author);
    doc = deleteEvent(doc, 'gone', author);

    const exported = exportableDoc(doc as TripDoc);

    expect(Object.keys(exported.events)).toEqual(['live']);

    /*
     * The orphan is the point. Deleting an event takes the attachment off the
     * event and leaves the file in the trip, where the Files page goes on
     * listing it -- so it is a file somebody can still open, and an export that
     * left it out would drop something they can see.
     */
    expect(Object.keys(exported.files ?? {}).sort()).toEqual([attached, orphaned].sort());
    expect(exported.files?.[orphaned]?.filename).toBe('cancelled.pdf');
  });

  it('carries a file from the library that no event uses', () => {
    let doc: Doc = A.from<TripDoc>({
      meta: { name: 'Japan, April', homeTimezone: 'Asia/Tokyo' },
      files: {},
      fieldDefs: {},
      events: {},
    });

    const hash = 'c'.repeat(64);
    doc = addTripFile(doc, {
      blobHash: hash,
      filename: 'insurance.pdf',
      mime: 'application/pdf',
      size: 900,
      addedAt: author.now,
    });

    // A trip can hold files without attaching them to anything -- that is what
    // the Files page is for -- so walking the events is not enough to find them.
    expect(Object.keys(exportableDoc(doc as TripDoc).files ?? {})).toEqual([hash]);
  });

  it('drops values whose field definition was deleted', () => {
    let doc: Doc = A.from<TripDoc>({
      meta: { name: 'Japan, April', homeTimezone: 'Asia/Tokyo' },
      files: {},
      fieldDefs: {},
      events: {},
    });

    doc = addFieldDef(doc, { id: 'f_cost', label: 'Cost', type: 'money', order: 0 });
    doc = addFieldDef(doc, { id: 'f_old', label: 'Was tracked', type: 'text', order: 1 });
    doc = addEvent(doc, { id: 'e1', name: 'Ryokan' }, author);
    doc = setCustomField(doc, 'e1', 'f_cost', { kind: 'number', number: 42 }, author);
    doc = setCustomField(doc, 'e1', 'f_old', { kind: 'text', text: 'stale' }, author);
    doc = deleteFieldDef(doc, 'f_old', author.now);

    const exported = exportableDoc(doc as TripDoc);

    expect(Object.keys(exported.fieldDefs)).toEqual(['f_cost']);
    // A value whose definition is gone shows as nothing and cannot be edited
    // back, so it travels as neither a value nor a mystery.
    expect(Object.keys(exported.events.e1!.customFields)).toEqual(['f_cost']);
  });

  it('names the download after the trip and the day, keeping names it cannot spell', () => {
    const day = Date.parse('2026-08-12T09:00:00Z');

    expect(archiveFilename('Japan, April', day)).toBe('Japan,-April-2026-08-12.zip');
    expect(archiveFilename('日本', day)).toBe('日本-2026-08-12.zip');
    // A name that survives nothing still has to produce a usable filename.
    expect(archiveFilename('///', day)).toBe('trip-2026-08-12.zip');
    expect(archiveFilename('../../etc/passwd', day)).toBe('etc-passwd-2026-08-12.zip');
  });
});

describe('reading an archive', () => {
  const emptyDoc = (): TripDoc => ({
    meta: { name: 'Japan, April', homeTimezone: 'Asia/Tokyo' },
    files: {},
    fieldDefs: {},
    events: {},
  });

  let root: string;
  let blobs: FsBlobStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'trip-archive-'));
    blobs = new FsBlobStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses bytes that are not a zip at all', () => {
    expect(() => readArchive(new TextEncoder().encode('not a zip'))).toThrow(/not a readable zip/);
  });

  it('refuses a zip with no manifest in it', () => {
    const zip = zipSync({ 'notes.txt': new TextEncoder().encode('hello') });
    expect(() => readArchive(zip)).toThrow(/no trip.json/);
  });

  it('refuses a manifest that is not a trip archive', () => {
    const zip = zipSync({ 'trip.json': new TextEncoder().encode('{"format":"something else"}') });
    expect(() => readArchive(zip)).toThrow(/not a trip archive/);
  });

  it('says so when the archive is newer than this server', async () => {
    const archive = await archiveBytes(emptyDoc(), blobs, author.now);
    const entries = unzipSync(archive);
    const manifest = JSON.parse(new TextDecoder().decode(entries['trip.json']!));

    const rewritten = zipSync({
      'trip.json': new TextEncoder().encode(JSON.stringify({ ...manifest, version: 99 })),
    });

    // A version it cannot read and a file that is damaged both fail to parse,
    // and only one of them is worth telling somebody to upgrade over.
    expect(() => readArchive(rewritten)).toThrow(/version 99/);
  });

  it('refuses an attachment that is not the bytes it is named after', async () => {
    const bytes = randomBytes(64);
    const hash = sha256(bytes);
    await blobs.put(hash, bytes, 'application/pdf');

    const doc = emptyDoc();
    doc.files = {
      [hash]: {
        blobHash: hash,
        filename: 'ticket.pdf',
        mime: 'application/pdf',
        size: 64,
        addedAt: author.now,
      },
    };

    const archive = await archiveBytes(doc, blobs, author.now);
    const entries = unzipSync(archive);
    entries[`files/${hash}`] = randomBytes(64);

    /*
     * Content addressing is the one promise the blob store makes, so a mismatch
     * is refused rather than stored. Taking these bytes would put them under the
     * name of a document somebody else already has, and nothing looks again.
     */
    expect(() => readArchive(zipSync(entries))).toThrow(/does not contain the bytes/);
  });

  it('drops a reference nobody has the bytes for, and says which', () => {
    const missing = 'c'.repeat(64);
    const doc = emptyDoc();
    doc.files = {
      [missing]: {
        blobHash: missing,
        filename: 'lost-scan.pdf',
        mime: 'application/pdf',
        size: 10,
        addedAt: author.now,
      },
    };
    doc.events = {
      e1: {
        id: 'e1',
        kind: 'activity',
        name: 'Ryokan',
        booking: { status: 'idea' },
        links: {},
        attachments: {
          a_1: {
            blobHash: missing,
            filename: 'lost-scan.pdf',
            mime: 'application/pdf',
            size: 10,
            addedAt: author.now,
          },
        },
        customFields: {},
        updatedAt: author.now,
        updatedBy: 'u1',
      },
    };

    const { doc: restored, dropped } = withoutUnavailableFiles(doc, new Set());

    expect(restored.files).toEqual({});
    expect(restored.events.e1!.attachments).toEqual({});
    expect(dropped.map((file) => file.filename)).toEqual(['lost-scan.pdf']);
  });
});

describe('exporting and importing over HTTP', () => {
  let db: Db;
  let docs: DocStore;
  let blobs: FsBlobStore;
  let app: ReturnType<typeof createApp>;
  let root: string;

  beforeEach(async () => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    root = await mkdtemp(join(tmpdir(), 'trip-archive-'));
    blobs = new FsBlobStore(root);
    docs = new DocStore(db);
    app = createApp({ db, docs, blobs });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** Creates a trip, and keeps the cookie the server minted a person into. */
  async function newTrip(name = 'Japan, April') {
    const response = await app.request('/api/trips', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, homeTimezone: 'Asia/Tokyo' }),
    });

    const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    const { id } = (await response.json()) as { id: string };

    return { id, cookie };
  }

  function edit(tripId: string, mutate: (doc: Doc) => Doc) {
    const before = docs.load(tripId)!;
    const after = mutate(before);
    docs.commit(tripId, after, A.getChanges(before, after), 'u1');
  }

  it('carries the whole trip, and the attachment bytes with it', async () => {
    const { id, cookie } = await newTrip();

    const scan = randomBytes(2048);
    const hash = sha256(scan);
    await blobs.put(hash, scan, 'application/pdf');

    // A second file that belongs to the trip without being on any event, which
    // is what the Files page holds.
    const guide = randomBytes(1024);
    const guideHash = sha256(guide);
    await blobs.put(guideHash, guide, 'application/pdf');

    edit(id, (doc) =>
      updateTripMeta(doc, { startsAt: author.now, endsAt: author.now + 86_400_000 }),
    );
    edit(id, (doc) => setCityColor(doc, 'Kyoto', '#136f5b'));
    edit(id, (doc) =>
      addFieldDef(doc, { id: 'f_cost', label: 'Cost', type: 'money', order: 0, currency: 'JPY' }),
    );
    edit(id, (doc) => addEvent(doc, { id: 'e1', name: 'Fushimi Inari', kind: 'activity' }, author));
    edit(id, (doc) =>
      updateEvent(
        doc,
        'e1',
        {
          city: 'Kyoto',
          startsAt: author.now,
          timezone: 'Asia/Tokyo',
          durationMinutes: 120,
          description: 'Go early, before the crowds.',
          location: { label: 'Fushimi Inari Taisha', lat: 34.9671, lng: 135.7727 },
          booking: { status: 'booked', confirmationCode: 'ABC123' },
        },
        author,
      ),
    );
    edit(id, (doc) => addTodo(doc, 'e1', 'todo_1', { text: 'Buy a rail pass' }, author));
    edit(id, (doc) =>
      setCustomField(doc, 'e1', 'f_cost', { kind: 'number', number: 4200 }, author),
    );
    edit(id, (doc) =>
      addAttachment(
        doc,
        'e1',
        'a_1',
        {
          blobHash: hash,
          filename: 'ticket.pdf',
          mime: 'application/pdf',
          size: scan.byteLength,
          addedAt: author.now,
        },
        author,
      ),
    );
    edit(id, (doc) =>
      addTripFile(doc, {
        blobHash: guideHash,
        filename: 'guidebook.pdf',
        mime: 'application/pdf',
        size: guide.byteLength,
        addedAt: author.now,
      }),
    );

    const exported = await app.request(`/api/trips/${id}/export`, { headers: { cookie } });
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toBe('application/zip');
    expect(exported.headers.get('content-disposition')).toContain('Japan,-April-');

    const archive = new Uint8Array(await exported.arrayBuffer());

    // Someone who unzips the download gets the scan back as a file, without
    // this application and without knowing what a hash is for.
    const entries = unzipSync(archive);
    expect(Buffer.from(entries[`files/${hash}`]!)).toEqual(scan);
    expect(Buffer.from(entries[`files/${guideHash}`]!)).toEqual(guide);

    /*
     * Imported by a different person, into a server that has never seen these
     * bytes, so nothing can be satisfied by what was already lying around.
     */
    const fresh = await mkdtemp(join(tmpdir(), 'trip-archive-'));
    try {
      const { db: db2 } = createDb(':memory:');
      runMigrations(db2, resolve(import.meta.dirname, '../drizzle'));
      const docs2 = new DocStore(db2);
      const blobs2 = new FsBlobStore(fresh);
      const app2 = createApp({ db: db2, docs: docs2, blobs: blobs2 });

      const imported = await app2.request('/api/trips/import', {
        method: 'POST',
        headers: { 'content-type': 'application/zip' },
        body: archive,
      });

      expect(imported.status).toBe(201);
      // The person the import minted on that empty server. Registration shuts
      // behind them, so every later request has to say it is still them.
      const importer = imported.headers.get('set-cookie')!.split(';')[0]!;
      const summary = (await imported.json()) as {
        id: string;
        name: string;
        role: string;
        events: number;
        droppedFiles: string[];
      };

      expect(summary.name).toBe('Japan, April');
      expect(summary.role).toBe('owner');
      expect(summary.events).toBe(1);
      expect(summary.droppedFiles).toEqual([]);

      const doc = docs2.load(summary.id) as TripDoc;
      const [eventId, event] = Object.entries(doc.events)[0]!;
      expect(doc.meta).toEqual({
        name: 'Japan, April',
        homeTimezone: 'Asia/Tokyo',
        startsAt: author.now,
        endsAt: author.now + 86_400_000,
      });
      expect(doc.cityColors).toEqual({ Kyoto: '#136f5b' });
      expect(doc.fieldDefs.f_cost?.currency).toBe('JPY');

      // The copy gets its own ids, so it can live beside the trip it came from.
      expect(eventId).not.toBe('e1');
      expect(event.id).toBe(eventId);
      expect(event.name).toBe('Fushimi Inari');
      expect(event.booking).toEqual({ status: 'booked', confirmationCode: 'ABC123' });
      expect(event.location).toEqual({
        label: 'Fushimi Inari Taisha',
        lat: 34.9671,
        lng: 135.7727,
      });
      expect(event.description).toBe('Go early, before the crowds.');
      expect(event.todos?.todo_1?.text).toBe('Buy a rail pass');
      expect(event.customFields.f_cost).toEqual({ kind: 'number', number: 4200 });
      expect(Object.values(event.attachments)[0]?.filename).toBe('ticket.pdf');

      // The bytes landed, under the same name, and are readable through the
      // route the file links point at.
      expect(Buffer.from((await blobs2.get(hash))!)).toEqual(scan);
      const download = await app2.request(`/api/blobs/${hash}`, {
        headers: { cookie: importer },
      });
      expect(Buffer.from(await download.arrayBuffer())).toEqual(scan);

      // The one that was on no event travels too, and keeps its name.
      expect(doc.files?.[guideHash]?.filename).toBe('guidebook.pdf');
      expect(Buffer.from((await blobs2.get(guideHash))!)).toEqual(guide);

      // The relational view is what search and the MCP tools read, so an
      // imported trip that never projected would be invisible to both.
      const projected = db2.select().from(eventRows).where(eq(eventRows.tripId, summary.id)).all();
      expect(projected.map((row) => row.name)).toEqual(['Fushimi Inari']);
      expect(projected[0]?.searchText).toContain('Fushimi Inari');
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it('imports a trip whose attachments are gone, and names what was lost', async () => {
    const { id, cookie } = await newTrip();

    const scan = randomBytes(512);
    const hash = sha256(scan);
    await blobs.put(hash, scan, 'application/pdf');

    edit(id, (doc) => addEvent(doc, { id: 'e1', name: 'Ryokan' }, author));
    edit(id, (doc) =>
      addAttachment(
        doc,
        'e1',
        'a_1',
        {
          blobHash: hash,
          filename: 'booking.pdf',
          mime: 'application/pdf',
          size: scan.byteLength,
          addedAt: author.now,
        },
        author,
      ),
    );

    // The blob goes before the export runs, which is what a sweep does to a
    // file whose event was deleted and then restored from an older snapshot.
    await blobs.delete(hash);

    const exported = await app.request(`/api/trips/${id}/export`, { headers: { cookie } });
    const archive = new Uint8Array(await exported.arrayBuffer());

    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(archive)['trip.json']!)) as {
      missingFiles: string[];
    };
    // The archive says what it is short of, rather than looking complete.
    expect(manifest.missingFiles).toEqual([hash]);

    const fresh = await mkdtemp(join(tmpdir(), 'trip-archive-'));
    try {
      const { db: db2 } = createDb(':memory:');
      runMigrations(db2, resolve(import.meta.dirname, '../drizzle'));
      const docs2 = new DocStore(db2);
      const app2 = createApp({ db: db2, docs: docs2, blobs: new FsBlobStore(fresh) });

      const imported = await app2.request('/api/trips/import', {
        method: 'POST',
        body: archive,
      });

      expect(imported.status).toBe(201);
      const summary = (await imported.json()) as { id: string; droppedFiles: string[] };
      expect(summary.droppedFiles).toEqual(['booking.pdf']);

      /*
       * The trip arrives whole apart from the file. A reference kept for bytes
       * nobody has renders a download that fails and cannot be repaired, so it
       * is removed on the way in and reported rather than left to be found.
       */
      const doc = docs2.load(summary.id) as TripDoc;
      const event = Object.values(doc.events)[0]!;
      expect(event.name).toBe('Ryokan');
      expect(event.attachments).toEqual({});
      expect(doc.files).toEqual({});
    } finally {
      await rm(fresh, { recursive: true, force: true });
    }
  });

  it('makes a copy that can live beside the trip it came from', async () => {
    const { id, cookie } = await newTrip();
    edit(id, (doc) => addEvent(doc, { id: 'e1', name: 'Fushimi Inari' }, author));
    edit(id, (doc) => addEvent(doc, { id: 'e2', name: 'Dinner' }, author));
    edit(id, (doc) => addLink(doc, 'e1', 'l_1', { url: 'https://inari-jinja.or.jp' }, author));
    edit(id, (doc) =>
      updateEvent(doc, 'e2', { description: 'Straight after @[Fushimi Inari](event:e1).' }, author),
    );

    const exported = await app.request(`/api/trips/${id}/export`, { headers: { cookie } });
    const archive = new Uint8Array(await exported.arrayBuffer());

    /*
     * Back into the server it came from, which is the case that fails if the
     * copy keeps its ids: the relational view keys an event by its id alone,
     * so the first event of the second copy collides with the first.
     */
    const imported = await app.request('/api/trips/import', {
      method: 'POST',
      headers: { cookie },
      body: archive,
    });

    expect(imported.status).toBe(201);
    const summary = (await imported.json()) as { id: string };
    expect(summary.id).not.toBe(id);

    const listed = await app.request('/api/trips', { headers: { cookie } });
    const { trips: listedTrips } = (await listed.json()) as { trips: Array<{ id: string }> };
    expect(listedTrips.map((trip) => trip.id).sort()).toEqual([id, summary.id].sort());

    const copy = docs.load(summary.id) as TripDoc;
    expect(Object.keys(copy.events).sort()).not.toEqual(['e1', 'e2']);

    /*
     * The mention has to follow the renumbering. A description names another
     * event by id in the middle of a sentence, so a copy that renumbers events
     * without rewriting these reads exactly as it did and points at nothing.
     */
    const inari = Object.values(copy.events).find((event) => event.name === 'Fushimi Inari')!;
    const dinner = Object.values(copy.events).find((event) => event.name === 'Dinner')!;
    expect(dinner.description).toBe(`Straight after @[Fushimi Inari](event:${inari.id}).`);

    // Links are re-keyed too: the projection makes their ids globally unique.
    expect(Object.keys(inari.links)).not.toEqual(['l_1']);
    expect(Object.values(inari.links)[0]?.url).toBe('https://inari-jinja.or.jp');

    const original = docs.load(id) as TripDoc;
    expect(Object.keys(original.events).sort()).toEqual(['e1', 'e2']);
  });

  it('will not export a trip the caller is not on', async () => {
    const { id, cookie } = await newTrip();

    // Registration shut behind the person who made the trip, so let somebody
    // else exist. Without this the refusal would be about the closed door
    // rather than about membership, which is what is under test.
    await app.request('/api/instance', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ registrationOpen: true }),
    });

    const stranger = await app.request('/api/me');
    const theirs = stranger.headers.get('set-cookie')!.split(';')[0]!;

    const response = await app.request(`/api/trips/${id}/export`, {
      headers: { cookie: theirs },
    });
    expect(response.status).toBe(403);
  });

  it('refuses an import that is not an archive', async () => {
    const response = await app.request('/api/trips/import', {
      method: 'POST',
      body: new TextEncoder().encode('this is not a zip'),
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('not_a_zip');
  });

  it('refuses an empty import', async () => {
    const response = await app.request('/api/trips/import', { method: 'POST' });
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('empty');
  });
});

describe('reading an archive written before flights folded into transit', () => {
  const legacyEvent = {
    id: 'e1',
    kind: 'flight',
    name: 'NH017',
    booking: { status: 'booked' },
    links: {},
    attachments: {},
    customFields: {},
    flight: { airline: 'ANA', number: 'NH017', from: 'NRT', to: 'LHR', seat: '32A' },
    updatedAt: 1,
    updatedBy: 'ada',
  };

  it('turns a stored flight into a transit journey with method flight', () => {
    const parsed = tripDocSchema.parse({
      meta: { name: 'Japan', homeTimezone: 'Asia/Tokyo' },
      fieldDefs: {},
      events: { e1: legacyEvent },
    });

    const event = parsed.events.e1!;
    expect(event.kind).toBe('transit');
    expect(event.transit).toEqual({
      method: 'flight',
      operator: 'ANA',
      number: 'NH017',
      from: 'NRT',
      to: 'LHR',
      seat: '32A',
    });
    expect((event as Record<string, unknown>).flight).toBeUndefined();
  });

  it('maps a custom field that applied to flights onto transit', () => {
    const parsed = tripDocSchema.parse({
      meta: { name: 'Japan', homeTimezone: 'Asia/Tokyo' },
      fieldDefs: {
        f1: { id: 'f1', label: 'Miles', type: 'number', appliesTo: ['flight'], order: 0 },
      },
      events: {},
    });

    expect(parsed.fieldDefs.f1!.appliesTo).toEqual(['transit']);
  });
});
