import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import * as A from '@automerge/automerge';
import { addAttachment } from '@trip/crdt';
import { auditLog, users } from '@trip/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { config } from './config';
import { FsBlobStore } from './blobs/FsBlobStore';
import { createDb, runMigrations, type Db } from './db';
import { DocStore } from './docStore';

type App = ReturnType<typeof createApp>;

const REDIRECT = 'http://127.0.0.1:33418/callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

/** A browser: a cookie jar, which is what the consent screen runs in. */
class Browser {
  cookie = '';

  constructor(private readonly app: App) {}

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
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  }
}

/**
 * Reopens registration, which the first person to arrive is the only one who
 * can do. Tests that need a second person say so here rather than assuming a
 * stranger can turn up and be given an account.
 */
async function letOthersIn(admin: Browser) {
  const result = await admin.request('/api/instance', {
    method: 'PATCH',
    body: JSON.stringify({ registrationOpen: true }),
  });

  expect(result.status).toBe(200);
}

async function rpc(app: App, accessToken: string, method: string, params?: unknown) {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

describe('the remote MCP server', () => {
  let app: App;
  let db: Db;
  let docs: DocStore;
  let blobs: FsBlobStore;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    docs = new DocStore(db);
    blobs = new FsBlobStore('/tmp/trip-mcp-blobs');
    app = createApp({ db, docs, blobs });
  });

  /** Registers, consents, and exchanges a code — the whole flow a client runs. */
  async function connect(scope = 'trips:read trips:write') {
    const browser = new Browser(app);

    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan, April', homeTimezone: 'Asia/Tokyo' }),
    });

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'An agent', redirectUris: [REDIRECT] }),
    });
    expect(registered.status).toBe(201);

    const { verifier, challenge } = pkce();

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: registered.body.clientId,
        redirect_uri: REDIRECT,
        scope,
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });
    expect(consent.status).toBe(200);

    const code = new URL(consent.body.redirect_to).searchParams.get('code')!;

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: registered.body.clientId,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);

    return {
      browser,
      tripId: trip.body.id as string,
      clientId: registered.body.clientId as string,
      accessToken: token.body.access_token as string,
      refreshToken: token.body.refresh_token as string,
      verifier,
      code,
    };
  }

  it('tells an unauthenticated caller where to get a token', async () => {
    const res = await app.request('/mcp', { method: 'POST', body: '{}' });

    expect(res.status).toBe(401);
    // The hint is how a client discovers the authorization server at all.
    expect(res.headers.get('WWW-Authenticate')).toContain('oauth-protected-resource');
  });

  it('publishes both discovery documents', async () => {
    const resource = await app.request('/.well-known/oauth-protected-resource');
    expect(resource.status).toBe(200);
    expect(((await resource.json()) as { authorization_servers: string[] }).authorization_servers).toHaveLength(1);

    const server = await app.request('/.well-known/oauth-authorization-server');
    const metadata = (await server.json()) as Record<string, string[]>;

    // S256 only: `plain` gives no protection against an intercepted code.
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(metadata.grant_types_supported).toContain('refresh_token');
  });

  it('lists its tools and runs one', async () => {
    const { accessToken, tripId } = await connect();

    const listed = await rpc(app, accessToken, 'tools/list');
    expect(listed.body.result.tools.map((t: { name: string }) => t.name)).toContain('create_event');

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari at dawn', city: 'Kyoto' },
    });
    expect(created.body.result.isError).toBeUndefined();

    const events = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId },
    });
    expect(events.body.result.content[0].text).toContain('Fushimi Inari at dawn');
  });

  it('takes a time as an ISO string as well as an epoch', async () => {
    const { accessToken, tripId } = await connect();

    // A model writing an offset date is likelier to be right than one doing
    // epoch arithmetic, so refusing this form would cost a round trip.
    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Flight', startsAt: '2026-08-14T09:00:00+09:00' },
    });
    expect(created.body.result.isError).toBeUndefined();

    const events = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId },
    });
    expect(events.body.result.content[0].text).toContain(String(Date.UTC(2026, 7, 14, 0, 0)));
  });

  it('refuses a trip the client was never granted', async () => {
    const { accessToken } = await connect();

    const result = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId: 't_somebody_elses' },
    });

    expect(result.body.result.isError).toBe(true);
    expect(result.body.result.content[0].text).toContain('not granted');
  });

  it('refuses a write when the grant was read-only', async () => {
    const { accessToken, tripId } = await connect('trips:read');

    const result = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Should not appear' },
    });

    expect(result.body.result.isError).toBe(true);
    expect(result.body.result.content[0].text).toContain('read-only');
  });

  it('records who did what, through which client', async () => {
    const { accessToken, tripId, clientId } = await connect();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari' },
    });

    const rows = db.select().from(auditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'mcp', clientId, toolName: 'create_event' });
    // Named in words, because the panel is read by a person deciding whether to
    // undo it rather than by the thing that wrote it.
    expect(rows[0]!.summary).toContain('Fushimi Inari');
  });

  it('captures what an update replaced, so it can be put back', async () => {
    const { accessToken, tripId } = await connect();

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari', city: 'Kyoto' },
    });
    const eventId = JSON.parse(created.body.result.content[0].text).eventId;

    const updated = await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: { tripId, eventId, city: 'Osaka' },
    });
    expect(updated.body.result.isError, updated.body.result.content[0].text).toBeUndefined();

    // The fields the caller did not mention are untouched. Sending the whole
    // set with most of them undefined would clear them, since an undefined
    // value is how the editor empties a box.
    const after = await rpc(app, accessToken, 'tools/call', {
      name: 'get_event',
      arguments: { tripId, eventId },
    });
    const event = JSON.parse(after.body.result.content[0].text).event;
    expect(event.name).toBe('Fushimi Inari');
    expect(event.city).toBe('Osaka');

    const update = db.select().from(auditLog).all().at(-1)!;
    const before = JSON.parse(update.beforeJson!);

    // Only the touched field is captured, so undoing this cannot revert
    // something somebody else changed in the meantime.
    expect(before).toEqual({ city: 'Kyoto' });
  });

  it('keeps the rest of a flight when one of its fields is set', async () => {
    const { accessToken, tripId } = await connect();

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'BOS -> SFO', kind: 'flight' },
    });
    const { eventId } = JSON.parse(created.body.result.content[0].text) as { eventId: string };

    await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: { tripId, eventId, flight: { airline: 'Delta', number: '860', from: 'BOS' } },
    });

    // A second call naming one field. The event holds its flight as a single
    // value, so this is the call that would flatten the other three.
    const patched = await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: { tripId, eventId, flight: { seat: '14C' } },
    });
    expect(patched.body.result.isError, patched.body.result.content[0].text).toBeUndefined();

    const after = await rpc(app, accessToken, 'tools/call', {
      name: 'get_event',
      arguments: { tripId, eventId },
    });
    const { event } = JSON.parse(after.body.result.content[0].text);

    expect(event.flight).toMatchObject({ airline: 'Delta', number: '860', from: 'BOS', seat: '14C' });
  });

  it('says when an event is over, so nobody adds up a duration across a date line', async () => {
    const { accessToken, tripId } = await connect();

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'BOS -> SFO', kind: 'flight' },
    });
    const { eventId } = JSON.parse(created.body.result.content[0].text) as { eventId: string };

    await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: {
        tripId,
        eventId,
        startsAt: '2026-08-21T10:05:00-04:00',
        durationMinutes: 394,
        timezone: 'America/New_York',
        flight: { departsTz: 'America/New_York', arrivesTz: 'America/Los_Angeles' },
      },
    });

    const after = await rpc(app, accessToken, 'tools/call', {
      name: 'get_event',
      arguments: { tripId, eventId },
    });
    const { event } = JSON.parse(after.body.result.content[0].text);

    // 13:39 in Los Angeles, the same afternoon it left Boston.
    expect(event.endsAt).toBe(Date.parse('2026-08-21T13:39:00-07:00'));
  });

  it('lists a trip\'s files, and the link it hands back fetches the bytes', async () => {
    const { accessToken, tripId } = await connect();

    // A file the way the app stores one: bytes under their own hash, and an
    // attachment on an event pointing at it.
    const bytes = new TextEncoder().encode('BOOKING REF: ABC123');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await blobs.put(hash, bytes, 'application/pdf');

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Hotel Granvia' },
    });
    const { eventId } = JSON.parse(created.body.result.content[0].text) as { eventId: string };

    const before = docs.load(tripId)!;
    const after = addAttachment(
      before,
      eventId,
      'a_1',
      { blobHash: hash, filename: 'confirmation.pdf', mime: 'application/pdf', size: bytes.length, addedAt: Date.now() },
      { userId: 'u1', now: Date.now() },
    );
    docs.commit(tripId, after, A.getChanges(before, after), 'u1');

    const listed = await rpc(app, accessToken, 'tools/call', {
      name: 'list_files',
      arguments: { tripId },
    });
    const { files } = JSON.parse(listed.body.result.content[0].text) as {
      files: { filename: string; mime: string; size: number; url: string; onEvents: string[] }[];
    };

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: 'confirmation.pdf',
      mime: 'application/pdf',
      onEvents: ['Hotel Granvia'],
    });

    /*
     * Followed with no session and no bearer token, which is all an agent has.
     * A link that only worked for a browser already signed in would be no use
     * to the one thing being handed it.
     */
    const url = new URL(files[0]!.url);
    const fetched = await app.request(url.pathname + url.search);

    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe('BOOKING REF: ABC123');
  });

  it('puts a file on the event it is attached to', async () => {
    const { accessToken, tripId } = await connect();

    const bytes = new TextEncoder().encode('ticket');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await blobs.put(hash, bytes, 'application/pdf');

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Shinkansen' },
    });
    const { eventId } = JSON.parse(created.body.result.content[0].text) as { eventId: string };

    const before = docs.load(tripId)!;
    const after = addAttachment(
      before,
      eventId,
      'a_1',
      { blobHash: hash, filename: 'ticket.pdf', mime: 'application/pdf', size: bytes.length, addedAt: Date.now() },
      { userId: 'u1', now: Date.now() },
    );
    docs.commit(tripId, after, A.getChanges(before, after), 'u1');

    const got = await rpc(app, accessToken, 'tools/call', {
      name: 'get_event',
      arguments: { tripId, eventId },
    });

    const { event } = JSON.parse(got.body.result.content[0].text) as {
      event: { files: { filename: string }[] };
    };
    expect(event.files.map((f) => f.filename)).toEqual(['ticket.pdf']);
  });

  it('refuses a download link that was tampered with or has run out', async () => {
    const bytes = new TextEncoder().encode('secret');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await blobs.put(hash, bytes, 'text/plain');

    // No signature at all, a made-up one, and one whose time has passed.
    for (const query of [
      '',
      `?expires=${Date.now() + 60_000}&sig=not-a-real-signature`,
      `?expires=${Date.now() - 1}&sig=whatever`,
    ]) {
      const res = await app.request(`/files/${hash}${query}`);
      expect(res.status, query || '(no signature)').toBe(403);
    }
  });

  it('serves the itinerary as markdown', async () => {
    const { accessToken, tripId } = await connect();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari', startsAt: '2026-08-14T09:00:00+09:00' },
    });

    const read = await rpc(app, accessToken, 'resources/read', {
      uri: `trip://${tripId}/itinerary`,
    });

    expect(read.body.result.contents[0].text).toContain('# Japan, April');
    expect(read.body.result.contents[0].text).toContain('Fushimi Inari');
  });

  it('writes itinerary times in the zone they happen in, on the local day', async () => {
    const { accessToken, tripId } = await connect();

    /*
     * One in the morning in Tokyo on the 15th is four in the afternoon UTC on
     * the 14th. Read as UTC it lands under the wrong heading at the wrong hour,
     * which is the whole of what this checks.
     */
    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Night bus', startsAt: '2026-08-15T01:00:00+09:00' },
    });

    const read = await rpc(app, accessToken, 'resources/read', {
      uri: `trip://${tripId}/itinerary`,
    });
    const text = read.body.result.contents[0].text as string;

    expect(text).toContain('## 2026-08-15');
    expect(text).toContain('**2026-08-15T01:00:00+09:00** Night bus');
    expect(text).not.toContain('## 2026-08-14');
  });

  it('files an event under its own zone rather than the trip home one', async () => {
    const { accessToken, tripId } = await connect();

    // The trip is planned from Tokyo, but this leg happens in Lisbon.
    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: {
        tripId,
        name: 'Tram 28',
        startsAt: '2026-08-14T09:00:00+01:00',
        timezone: 'Europe/Lisbon',
      },
    });

    const read = await rpc(app, accessToken, 'resources/read', {
      uri: `trip://${tripId}/itinerary`,
    });

    expect(read.body.result.contents[0].text).toContain('**2026-08-14T09:00:00+01:00** Tram 28');
  });

  it('still names the moment when an event carries a zone no calendar knows', async () => {
    const { accessToken, tripId } = await connect();

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Somewhere', startsAt: '2026-08-14T09:00:00Z' },
    });
    const { eventId } = JSON.parse(created.body.result.content[0].text) as { eventId: string };

    // Nothing validates a zone on the way in, and a resource that throws is
    // worse than one that falls back to naming the instant in UTC.
    await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: { tripId, eventId, timezone: 'Mars/Olympus_Mons' },
    });

    const read = await rpc(app, accessToken, 'resources/read', {
      uri: `trip://${tripId}/itinerary`,
    });

    expect(read.body.result.contents[0].text).toContain('**2026-08-14T09:00:00+00:00** Somewhere');
  });
});

describe('the OAuth server', () => {
  let app: App;
  let db: Db;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore('/tmp/trip-mcp-blobs') });
  });

  async function register(browser: Browser, redirectUris = [REDIRECT]) {
    // Credentials are only handed to a browser that has been here before, so
    // settle an identity first. The app does the same on its first paint.
    await browser.request('/api/me');

    const res = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'An agent', redirectUris }),
    });
    return res.body.clientId as string;
  }

  async function authorize(browser: Browser, clientId: string, challenge: string, tripIds: string[]) {
    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:read',
        code_challenge: challenge,
        trip_ids: tripIds,
      }),
    });
    return new URL(consent.body.redirect_to).searchParams.get('code')!;
  }

  it('refuses a code redeemed twice', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const body = JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    });

    expect((await browser.request('/oauth/token', { method: 'POST', body })).status).toBe(200);
    // A code that works twice is a code an eavesdropper can also use.
    expect((await browser.request('/oauth/token', { method: 'POST', body })).status).toBe(400);
  });

  it('refuses a mismatched PKCE verifier', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const result = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: pkce().verifier,
      }),
    });

    expect(result.status).toBe(400);
    expect(result.body.error_description).toContain('PKCE');
  });

  it('refuses a redirect the client never registered', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const result = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: 'https://somewhere-else.example/steal',
        scope: 'trips:read',
        code_challenge: pkce().challenge,
        trip_ids: [],
      }),
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_redirect_uri');
  });

  it('grants only trips the person actually holds', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();

    // Naming somebody else's trip in the request must not grant it, or the
    // consent screen would be describing one thing and authorising another.
    const code = await authorize(browser, clientId, challenge, ['t_not_mine']);

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    const listed = await rpc(app, token.body.access_token, 'tools/call', {
      name: 'list_trips',
      arguments: {},
    });

    expect(JSON.parse(listed.body.result.content[0].text).trips).toEqual([]);
  });

  it('rotates refresh tokens and revokes the family when one is reused', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const first = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    const refreshOnce = JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: first.body.refresh_token,
      client_id: clientId,
    });

    const second = await browser.request('/oauth/token', { method: 'POST', body: refreshOnce });
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.body.refresh_token);

    /*
     * Presenting the old one again means it leaked: the legitimate holder has
     * the newer one. Which of the two callers is the attacker cannot be known,
     * so the whole family goes and both have to start again.
     */
    const replay = await browser.request('/oauth/token', { method: 'POST', body: refreshOnce });
    expect(replay.status).toBe(400);
    expect(replay.body.error_description).toContain('reuse');

    const afterReuse = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: second.body.refresh_token,
        client_id: clientId,
      }),
    });
    expect(afterReuse.status).toBe(400);
  });

  it('stops working once the token is revoked', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    expect((await rpc(app, token.body.access_token, 'tools/list')).status).toBe(200);

    const form = new FormData();
    form.set('token', token.body.access_token);
    await app.request('/oauth/revoke', { method: 'POST', body: form });

    expect((await rpc(app, token.body.access_token, 'tools/list')).status).toBe(401);
  });

  /** The query a client sends when it opens the consent screen in a browser. */
  function authorizeQuery(clientId: string, challenge: string, scope = 'trips:read') {
    return new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
  }

  it('describes the request for the consent screen to render', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);

    const result = await browser.request(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge, 'trips:read trips:write')}`,
    );

    expect(result.status).toBe(200);
    expect(result.body.client.name).toBe('An agent');
    expect(result.body.client.redirectOrigin).toBe('http://127.0.0.1:33418');
    expect(result.body.scope).toBe('trips:read trips:write');
    expect(result.body.trips.map((t: { id: string }) => t.id)).toEqual([trip.body.id]);
    expect(result.body.you.userId).toMatch(/^u_/);
  });

  it('offers only the trips the person signed in holds', async () => {
    const owner = new Browser(app);
    await owner.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Not yours', homeTimezone: 'UTC' }),
    });

    await letOthersIn(owner);

    // A second browser is a second person. The screen they are shown must
    // describe their own trips, not whoever registered the client.
    const stranger = new Browser(app);
    const clientId = await register(stranger);
    const result = await stranger.request(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge)}`,
    );

    expect(result.status).toBe(200);
    expect(result.body.trips).toEqual([]);
  });

  it('refuses a scope this server does not have', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const asked = await browser.request(
      `/oauth/authorize?${authorizeQuery(clientId, pkce().challenge, 'trips:read trips:delete')}`,
    );
    expect(asked.status).toBe(400);
    expect(asked.body.error).toBe('invalid_scope');

    // And again at the point it would be written into a grant, so a client
    // posting straight past the screen cannot smuggle one in.
    const consented = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:delete',
        code_challenge: pkce().challenge,
        trip_ids: [],
      }),
    });
    expect(consented.status).toBe(400);
    expect(consented.body.error).toBe('invalid_scope');
  });

  it('sends the client back with access_denied when the person says no', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const result = await browser.request('/oauth/authorize/deny', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, redirect_uri: REDIRECT, state: 'abc' }),
    });

    expect(result.status).toBe(200);
    const back = new URL(result.body.redirect_to);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('abc');
    expect(back.searchParams.get('code')).toBeNull();
  });

  it('will not send a refusal to a redirect the client never registered', async () => {
    const browser = new Browser(app);
    const clientId = await register(browser);

    const result = await browser.request('/oauth/authorize/deny', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: 'https://somewhere-else.example/steal',
      }),
    });

    expect(result.status).toBe(400);
    expect(result.body.error).toBe('invalid_redirect_uri');
  });

  it('makes a client that registered a secret present it', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A server-side agent',
        redirectUris: [REDIRECT],
        confidential: true,
      }),
    });
    const clientId = registered.body.clientId as string;
    const secret = registered.body.clientSecret as string;
    expect(secret).toBeTruthy();

    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const grant = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT,
      client_id: clientId,
      code_verifier: verifier,
    };

    const withoutSecret = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify(grant),
    });
    expect(withoutSecret.status).toBe(401);
    expect(withoutSecret.body.error).toBe('invalid_client');

    const withSecret = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({ ...grant, client_secret: secret }),
    });
    expect(withSecret.status).toBe(200);
    expect(withSecret.body.access_token).toBeTruthy();
  });

  it('refuses to register a plain HTTP redirect that leaves the machine', async () => {
    const browser = new Browser(app);
    await browser.request('/api/me');

    const remote = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: ['http://agent.example/callback'],
      }),
    });
    expect(remote.status).toBe(400);

    // The same URI over TLS is what a hosted client should be registering.
    const secure = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: ['https://agent.example/callback'],
      }),
    });
    expect(secure.status).toBe(201);
  });

  it('connects a hosted client that keeps a secret and an https redirect', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const hostedRedirect = 'https://agent.example/oauth/callback';
    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: [hostedRedirect],
        confidential: true,
      }),
    });

    const clientId = registered.body.clientId as string;
    const { verifier, challenge } = pkce();

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: hostedRedirect,
        scope: 'trips:read trips:write',
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });
    expect(consent.status).toBe(200);

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: new URL(consent.body.redirect_to).searchParams.get('code'),
        redirect_uri: hostedRedirect,
        client_id: clientId,
        client_secret: registered.body.clientSecret,
        code_verifier: verifier,
      }),
    });
    expect(token.status).toBe(200);

    const listed = await rpc(app, token.body.access_token, 'tools/call', {
      name: 'list_trips',
      arguments: {},
    });
    expect(JSON.parse(listed.body.result.content[0].text).trips).toHaveLength(1);
  });

  it('will not let a hosted client swap in another host at the redirect', async () => {
    const browser = new Browser(app);
    await browser.request('/api/me');

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: 'A hosted agent',
        redirectUris: ['https://agent.example/oauth/callback'],
      }),
    });

    // Off-loopback URIs match exactly, so a path or host the client did not
    // register is refused however close it looks.
    for (const uri of [
      'https://agent.example.evil/oauth/callback',
      'https://agent.example/oauth/callback/../../steal',
      'https://evil.example/oauth/callback',
    ]) {
      const result = await browser.request('/oauth/authorize/consent', {
        method: 'POST',
        body: JSON.stringify({
          client_id: registered.body.clientId,
          redirect_uri: uri,
          scope: 'trips:read',
          code_challenge: pkce().challenge,
          trip_ids: [],
        }),
      });

      expect(result.status, uri).toBe(400);
      expect(result.body.error).toBe('invalid_redirect_uri');
    }
  });

  it('will not hand credentials to a request that arrived without a session', async () => {
    // No cookie jar: a bare POST, the way anything on the internet would reach
    // it. `withIdentity` would otherwise mint a person and treat it as them.
    const result = await app.request('/api/clients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Uninvited', redirectUris: ['https://agent.example/cb'] }),
    });

    expect(result.status).toBe(401);
    expect(((await result.json()) as { error: string }).error).toBe('not_signed_in');
  });

  it('no longer advertises a registration endpoint for agents to use', async () => {
    const metadata = await app.request('/.well-known/oauth-authorization-server');
    const body = (await metadata.json()) as Record<string, unknown>;

    expect(body.registration_endpoint).toBeUndefined();
    expect(body.token_endpoint).toBeTruthy();
  });

  it('lists only the clients you made, and forgets them when you say so', async () => {
    const mine = new Browser(app);
    const clientId = await register(mine);

    const listed = await mine.request('/api/clients');
    expect(listed.body.clients.map((c: { clientId: string }) => c.clientId)).toEqual([clientId]);

    await letOthersIn(mine);

    // Somebody else's list is their own, and their delete does not reach it.
    const stranger = new Browser(app);
    await stranger.request('/api/me');
    expect((await stranger.request('/api/clients')).body.clients).toEqual([]);
    expect((await stranger.request(`/api/clients/${clientId}`, { method: 'DELETE' })).status).toBe(404);

    expect((await mine.request(`/api/clients/${clientId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await mine.request('/api/clients')).body.clients).toEqual([]);
  });

  it('stops an agent working the moment its client is taken away', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();
    const code = await authorize(browser, clientId, challenge, [trip.body.id]);

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    const accessToken = token.body.access_token as string;
    expect((await rpc(app, accessToken, 'tools/list')).status).toBe(200);

    expect((await browser.request(`/api/clients/${clientId}`, { method: 'DELETE' })).status).toBe(200);

    /*
     * Nothing on the MCP path reads the client table, so deleting the row alone
     * would leave the token working until it expired an hour later.
     */
    expect((await rpc(app, accessToken, 'tools/list')).status).toBe(401);
  });

  it('makes the first person admin and shuts the door behind them', async () => {
    const first = new Browser(app);
    const me = await first.request('/api/me');

    expect(me.status).toBe(200);
    expect(me.body.admin).toBe(true);
    expect(me.body.registrationOpen).toBe(false);

    // Anyone after them is refused rather than quietly given an account.
    const second = new Browser(app);
    const refused = await second.request('/api/me');
    expect(refused.status).toBe(401);
    expect(refused.body.error).toBe('registration_closed');

    await letOthersIn(first);

    const third = new Browser(app);
    const welcomed = await third.request('/api/me');
    expect(welcomed.status).toBe(200);
    // Only one admin: the door being open does not hand out the server.
    expect(welcomed.body.admin).toBe(false);
  });

  it('makes the earliest person admin on a database that predates the door', async () => {
    // Two people who arrived before any of this existed: no admin, and the
    // settings row not yet written.
    const before = Date.now() - 60_000;
    db.insert(users)
      .values([
        { id: 'u_later', displayName: 'Later', avatarColor: '#136f5b', createdAt: before + 1000 },
        { id: 'u_earliest', displayName: 'Earliest', avatarColor: '#b06e12', createdAt: before },
      ])
      .run();

    // Reading the setting is what settles it, so an upgraded server does not
    // sit open to anyone with nobody holding the key.
    const stranger = new Browser(app);
    expect((await stranger.request('/api/me')).status).toBe(401);

    const rows = db.select().from(users).all();
    expect(rows.find((u) => u.id === 'u_earliest')?.adminSince).toBeTruthy();
    expect(rows.find((u) => u.id === 'u_later')?.adminSince).toBeNull();
  });

  it('lets nobody but the admin decide who may join', async () => {
    const admin = new Browser(app);
    await admin.request('/api/me');
    await letOthersIn(admin);

    const other = new Browser(app);
    await other.request('/api/me');

    const attempt = await other.request('/api/instance', {
      method: 'PATCH',
      body: JSON.stringify({ registrationOpen: false }),
    });

    expect(attempt.status).toBe(403);
    expect(attempt.body.error).toBe('not_admin');
  });

  it('lets a share link in while the door is shut', async () => {
    const admin = new Browser(app);
    const trip = await admin.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const share = await admin.request(`/api/trips/${trip.body.id}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'editor' }),
    });

    const guest = new Browser(app);
    expect((await guest.request('/api/trips')).status).toBe(401);

    // The link is the invitation, and redeeming it is what creates the account.
    const redeemed = await guest.request(`/api/share/${share.body.token}`, { method: 'POST' });
    expect(redeemed.status).toBe(200);
    expect((await guest.request('/api/trips')).body.trips).toHaveLength(1);
  });

  it('is not let in by a share link that was revoked', async () => {
    const admin = new Browser(app);
    const trip = await admin.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const share = await admin.request(`/api/trips/${trip.body.id}/share`, {
      method: 'POST',
      body: JSON.stringify({ role: 'editor' }),
    });

    const access = await admin.request(`/api/trips/${trip.body.id}/access`);
    const linkId = access.body.links[0].id as string;
    await admin.request(`/api/trips/${trip.body.id}/access/links/${linkId}/revoke`, {
      method: 'POST',
    });

    /*
     * A dead link is not an invitation. Were the account created first and the
     * link checked afterwards, anyone could mint themselves one by naming a
     * token that never worked.
     */
    const guest = new Browser(app);
    const refused = await guest.request(`/api/share/${share.body.token}`, { method: 'POST' });
    expect([401, 404]).toContain(refused.status);
  });

  it('lets a hosted agent redeem its code with no session at all', async () => {
    const { browser, tripId } = await (async () => {
      const b = new Browser(app);
      const t = await b.request('/api/trips', {
        method: 'POST',
        body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
      });
      return { browser: b, tripId: t.body.id as string };
    })();

    const clientId = await register(browser, ['https://agent.example/cb']);
    const { verifier, challenge } = pkce();

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: 'https://agent.example/cb',
        scope: 'trips:read',
        code_challenge: challenge,
        trip_ids: [tripId],
      }),
    });

    /*
     * No cookie jar. The agent's own server does this half, and on a closed
     * instance it would be turned away if the token endpoint wanted a person.
     */
    const token = await app.request('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: new URL(consent.body.redirect_to).searchParams.get('code'),
        redirect_uri: 'https://agent.example/cb',
        client_id: clientId,
        code_verifier: verifier,
      }),
    });

    expect(token.status).toBe(200);
    const granted = (await token.json()) as { access_token: string };
    expect((await rpc(app, granted.access_token, 'tools/list')).status).toBe(200);
  });

  it('accepts a token asked for by the endpoint address, which is what clients send', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();

    /*
     * The protected resource is the MCP endpoint, so this is the address a
     * client puts in `resource`. Binding tokens to the bare origin instead
     * meant issuing one and then refusing it a second later.
     */
    const resource = `${config.PUBLIC_URL}/mcp`;

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:read',
        resource,
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: new URL(consent.body.redirect_to).searchParams.get('code'),
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    });
    expect(token.status).toBe(200);

    expect((await rpc(app, token.body.access_token, 'tools/list')).status).toBe(200);
  });

  it('publishes the endpoint as the resource, under both well-known paths', async () => {
    for (const path of [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const res = await app.request(path);
      const body = (await res.json()) as { resource: string; authorization_servers: string[] };

      expect(res.status, path).toBe(200);
      expect(body.resource, path).toBe(`${config.PUBLIC_URL}/mcp`);
      // The issuer is still the site: that is where the token endpoint lives.
      expect(body.authorization_servers, path).toEqual([config.PUBLIC_URL]);
    }
  });

  it('still refuses a token minted for somewhere else entirely', async () => {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });
    const clientId = await register(browser);
    const { verifier, challenge } = pkce();

    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:read',
        resource: 'https://somewhere-else.example/mcp',
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });

    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: new URL(consent.body.redirect_to).searchParams.get('code'),
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource: 'https://somewhere-else.example/mcp',
      }),
    });

    // Loosening the audience to two spellings of this server must not have
    // loosened it to anything that is not this server.
    expect((await rpc(app, token.body.access_token, 'tools/list')).status).toBe(401);
  });

  it('points clients at the consent screen, not at the endpoint behind it', async () => {
    const metadata = await app.request('/.well-known/oauth-authorization-server');
    const body = (await metadata.json()) as Record<string, string>;

    // A browser sent to /oauth/authorize is shown JSON, which is not a screen
    // anyone can approve anything on.
    expect(new URL(body.authorization_endpoint!).pathname).toBe('/connect');
  });
});

describe('undoing what an agent did', () => {
  let app: App;
  let db: Db;

  beforeEach(() => {
    ({ db } = createDb(':memory:'));
    runMigrations(db, resolve(import.meta.dirname, '../drizzle'));
    app = createApp({ db, docs: new DocStore(db), blobs: new FsBlobStore('/tmp/trip-mcp-blobs') });
  });

  async function setup() {
    const browser = new Browser(app);
    const trip = await browser.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ name: 'Japan', homeTimezone: 'UTC' }),
    });

    const registered = await browser.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'An agent', redirectUris: [REDIRECT] }),
    });
    const { verifier, challenge } = pkce();
    const consent = await browser.request('/oauth/authorize/consent', {
      method: 'POST',
      body: JSON.stringify({
        client_id: registered.body.clientId,
        redirect_uri: REDIRECT,
        scope: 'trips:read trips:write',
        code_challenge: challenge,
        trip_ids: [trip.body.id],
      }),
    });
    const token = await browser.request('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: new URL(consent.body.redirect_to).searchParams.get('code'),
        redirect_uri: REDIRECT,
        client_id: registered.body.clientId,
        code_verifier: verifier,
      }),
    });

    return { browser, tripId: trip.body.id as string, accessToken: token.body.access_token as string };
  }

  it('puts back the value an agent replaced, and says who did it', async () => {
    const { browser, tripId, accessToken } = await setup();

    const created = await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Fushimi Inari', city: 'Kyoto' },
    });
    const eventId = JSON.parse(created.body.result.content[0].text).eventId;

    await rpc(app, accessToken, 'tools/call', {
      name: 'update_event',
      arguments: { tripId, eventId, city: 'Osaka' },
    });

    const log = await browser.request(`/api/audit/${tripId}?source=mcp`);
    expect(log.body.entries).toHaveLength(2);
    expect(log.body.entries[0].summary).toContain('Changed');
    expect(log.body.entries[0].actor).toBeTruthy();

    const undo = await browser.request(`/api/audit/${tripId}/${log.body.entries[0].id}/undo`, {
      method: 'POST',
    });
    expect(undo.status).toBe(200);

    const after = await rpc(app, accessToken, 'tools/call', {
      name: 'get_event',
      arguments: { tripId, eventId },
    });
    expect(JSON.parse(after.body.result.content[0].text).event.city).toBe('Kyoto');
  });

  it('undoes a creation by removing what it made', async () => {
    const { browser, tripId, accessToken } = await setup();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Should not survive' },
    });

    const log = await browser.request(`/api/audit/${tripId}`);
    await browser.request(`/api/audit/${tripId}/${log.body.entries[0].id}/undo`, { method: 'POST' });

    const events = await rpc(app, accessToken, 'tools/call', {
      name: 'list_events',
      arguments: { tripId },
    });
    expect(events.body.result.content[0].text).not.toContain('Should not survive');
  });

  it('refuses to undo the same action twice', async () => {
    const { browser, tripId, accessToken } = await setup();

    await rpc(app, accessToken, 'tools/call', {
      name: 'create_event',
      arguments: { tripId, name: 'Once' },
    });

    const log = await browser.request(`/api/audit/${tripId}`);
    const path = `/api/audit/${tripId}/${log.body.entries[0].id}/undo`;

    expect((await browser.request(path, { method: 'POST' })).status).toBe(200);
    // The second one would delete an already-deleted event, which is harmless
    // here but would not be for an undo that puts a value back.
    expect((await browser.request(path, { method: 'POST' })).status).toBe(409);
  });
});
